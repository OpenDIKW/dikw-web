#!/usr/bin/env node
// Observability-driven agent↔core integration check.
//
// Drives ONE real chat turn through the dikw-web sidecar (which calls the live
// core) and verifies the agent↔core integration via the agent's observability
// surfaces — the signal the mocked e2e suite can't give: proof the agent
// actually reached core.
//
// HARD assertion: the turn invoked a core-backed tool (retrieve_knowledge /
// read_page / …), read off the AgentStreamEvent tool_event stream — the same
// curated tool surface the chat right-rail and #trace tool list show.
//
// BONUS: the in-memory trace waterfall (GET /agent/sessions/{id}/traces, the
// #trace span store). Reported when present, but NOT required: under `vite dev`
// ADK binds its OTel tracer at module load, before the sidecar registers the
// span processor, so the dev store stays empty (the standalone sidecar /
// OTLP-exported spans are unaffected). We still assert the traces endpoint
// returns its documented shape.
//
// Requires the dikw-web dev server running (DIKW_LIVE_WEB_URL) and the sidecar's
// own LLM key (DIKW_AGENT_API_KEY, from .env.local). Missing key ⇒ SKIP (not a
// failure). See docs/integration-verification.md.

import { loadState } from "./harness.mjs";

const CORE_TOOLS = new Set([
  "retrieve_knowledge",
  "read_page",
  "page_links",
  "list_wisdom",
  "dikw_health",
]);

const PROMPT =
  "Search the knowledge base and tell me what its page about Data and Information says. Use the knowledge base tools.";

function webUrl() {
  const url = process.env.DIKW_LIVE_WEB_URL;
  if (!url) throw new Error("DIKW_LIVE_WEB_URL is not set (the running dikw-web dev server URL).");
  return url.replace(/\/+$/, "");
}

async function main() {
  const state = loadState();
  const base = webUrl();

  // 1) Create a session.
  const created = await fetch(`${base}/agent/sessions`, { method: "POST" });
  if (!created.ok) throw new Error(`create session -> HTTP ${created.status}`);
  const sessionId = (await created.json()).id;
  console.log(`[agent] session ${sessionId}`);

  // 2) Send one message; drain the NDJSON stream.
  const res = await fetch(`${base}/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: PROMPT, coreUrl: state.coreUrl, token: state.token }),
  });
  if (!res.ok || !res.body) throw new Error(`messages -> HTTP ${res.status}`);

  const toolCalls = [];
  let sawAgentEnd = false;
  let configError = null;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "tool_event" && ev.event?.name) toolCalls.push(ev.event.name);
      if (ev.type === "agent_end") sawAgentEnd = true;
      if (ev.type === "error") {
        // A missing/disabled sidecar LLM key is a SKIP, not a failure.
        if (/api[_ ]?key|not configured|disabled|credential/i.test(ev.message || "")) {
          configError = ev.message;
        } else {
          throw new Error(`agent error: ${ev.code} ${ev.message}`);
        }
      }
    }
  }

  if (configError) {
    console.log(`[agent] SKIP — sidecar LLM not configured: ${configError}`);
    console.log("        set DIKW_AGENT_API_KEY in .env.local to run the agent↔core check.");
    return;
  }
  if (!sawAgentEnd) throw new Error("agent turn did not complete (no agent_end event)");

  // HARD: the agent invoked a core-backed tool (proves it reached core).
  const coreToolCalls = toolCalls.filter((name) => CORE_TOOLS.has(name));
  if (coreToolCalls.length === 0) {
    throw new Error(
      `agent turn invoked no core tool (saw: ${toolCalls.join(", ") || "none"}). Expected one of ${[...CORE_TOOLS].join("/")}.`,
    );
  }

  // BONUS: the in-memory trace waterfall. Assert the endpoint's shape; report
  // span count when present, but don't require it (empty under `vite dev`).
  const tracesRes = await fetch(`${base}/agent/sessions/${encodeURIComponent(sessionId)}/traces`);
  if (!tracesRes.ok) throw new Error(`traces -> HTTP ${tracesRes.status}`);
  const traces = await tracesRes.json();
  if (!Array.isArray(traces.invocations)) {
    throw new Error("traces endpoint did not return an { invocations: [] } shape");
  }
  const spanCount = traces.invocations.reduce((n, inv) => n + (inv.spans?.length || 0), 0);

  console.log(
    `[agent] core tools: ${coreToolCalls.join(", ")} | trace waterfall: ${spanCount} spans across ${traces.invocations.length} invocations`,
  );
  console.log(
    `\n[agent] ✓ agent↔core verified: core tools invoked over the live core.${
      spanCount === 0
        ? " (in-memory trace waterfall empty — expected under `vite dev`; populated by the standalone sidecar / OTLP export.)"
        : ""
    }`,
  );
}

main().catch((error) => {
  console.error(`✖ verify-agent failed: ${error.message}`);
  process.exit(1);
});
