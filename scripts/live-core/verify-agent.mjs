#!/usr/bin/env node
// Observability-driven agent↔core integration check.
//
// Drives ONE real chat turn through the dikw-web sidecar (which calls the live
// core) and verifies the agent↔core integration via the agent's observability
// surfaces — the signal the mocked e2e suite can't give: proof the agent
// actually reached core.
//
// HARD assertion: a core-backed tool (retrieve_knowledge / read_page / …)
// reached status:"succeeded", read off the AgentStreamEvent tool_event stream —
// the same curated tool surface the chat right-rail and #trace tool list show.
// Not merely "invoked": a `fetch failed` call still emits a tool_event, so the
// success status is what proves the turn round-tripped to core.
//
// We send the DEFAULT core URL (not the live core's dynamic URL), exactly like
// the browser: dikw-core has no CORS, so the chat UI keeps serverUrl at the
// default and rides the same-origin Vite proxy. The sidecar's /agent calls
// bypass that proxy and must independently honor VITE_DIKW_PROXY_TARGET. Sending
// the real core URL here would dial core directly and mask the very bug the
// browser hits (every tool → `fetch failed`). See server/agent/http.ts
// applyDevProxyTarget and the dev proxy in vite.config.ts.
//
// BONUS: the in-memory trace waterfall (GET /agent/sessions/{id}/traces, the
// #trace span store). Reported when present, but NOT required: under `vite dev`
// ADK binds its OTel tracer at module load, before the sidecar registers the
// span processor, so the dev store stays empty (the standalone sidecar /
// OTLP-exported spans are unaffected). We still assert the traces endpoint
// returns its documented shape.
//
// Requires the dikw-web dev server running (DIKW_LIVE_WEB_URL) with its Vite
// `/v1` proxy pointed at the live core (VITE_DIKW_PROXY_TARGET) — i.e. the
// `live:verify` / browser-verify setup, since we send the default core URL and
// rely on the sidecar mirroring that proxy. It also needs the sidecar's own LLM
// key (DIKW_AGENT_API_KEY, from .env.local). Missing key ⇒ SKIP (not a failure).
// `run.mjs` wires both up; running it against a plain `npm run dev` won't reach
// core. See docs/integration-verification.md.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadState, REPO_ROOT } from "./harness.mjs";

/** The sidecar resolves DIKW_AGENT_API_KEY from process.env or .env.local
 *  (server/agent/config.ts). Mirror that here so we can SKIP cleanly before
 *  hitting /agent when the agent isn't configured, instead of inferring it from
 *  a stream-error message after the fact. */
function hasAgentKey() {
  if (process.env.DIKW_AGENT_API_KEY?.trim()) return true;
  const envLocal = join(REPO_ROOT, ".env.local");
  if (!existsSync(envLocal)) return false;
  for (const raw of readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() === "DIKW_AGENT_API_KEY" && line.slice(eq + 1).trim()) {
      return true;
    }
  }
  return false;
}

const CORE_TOOLS = new Set([
  "retrieve_knowledge",
  "read_page",
  "page_links",
  "list_wisdom",
  "dikw_health",
]);

const PROMPT =
  "Search the knowledge base and tell me what its page about Data and Information says. Use the knowledge base tools.";

// Mirror the browser: it keeps serverUrl at this default so its /v1 reads ride
// the same-origin Vite proxy (dikw-core has no CORS). Keep in sync with
// src/config/connection.ts defaultServerUrl.
const DEFAULT_CORE_URL = "http://127.0.0.1:8765";

function webUrl() {
  const url = process.env.DIKW_LIVE_WEB_URL;
  if (!url) throw new Error("DIKW_LIVE_WEB_URL is not set (the running dikw-web dev server URL).");
  return url.replace(/\/+$/, "");
}

async function main() {
  const state = loadState();
  const base = webUrl();

  // Skip cleanly if the sidecar's own LLM key isn't configured.
  if (!hasAgentKey()) {
    console.log("[agent] SKIP — DIKW_AGENT_API_KEY not set (process.env or .env.local).");
    console.log("        set it to run the agent↔core observability check.");
    return;
  }

  // 1) Create a session.
  const created = await fetch(`${base}/agent/sessions`, { method: "POST" });
  if (!created.ok) throw new Error(`create session -> HTTP ${created.status}`);
  const sessionId = (await created.json()).id;
  console.log(`[agent] session ${sessionId}`);

  // 2) Send one message; drain the NDJSON stream.
  const res = await fetch(`${base}/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: PROMPT, coreUrl: DEFAULT_CORE_URL, token: state.token }),
  });
  if (!res.ok || !res.body) throw new Error(`messages -> HTTP ${res.status}`);

  const toolEvents = [];
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
      if (ev.type === "tool_event" && ev.event?.name) {
        toolEvents.push({ name: ev.event.name, status: ev.event.status });
      }
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

  // HARD: a core-backed tool SUCCEEDED. Checking only that the tool was *invoked*
  // is too weak — a `fetch failed` tool call still emits a tool_event (with
  // status:"failed"), so a sidecar that can't reach core would pass. Requiring a
  // succeeded status is what proves the turn actually round-tripped to core, and
  // is what catches the "fetch failed" chat bug (a default core URL not routed
  // through VITE_DIKW_PROXY_TARGET).
  const coreEvents = toolEvents.filter((e) => CORE_TOOLS.has(e.name));
  const succeeded = [
    ...new Set(coreEvents.filter((e) => e.status === "succeeded").map((e) => e.name)),
  ];
  if (succeeded.length === 0) {
    const failed = [...new Set(coreEvents.filter((e) => e.status === "failed").map((e) => e.name))];
    const invoked = [...new Set(coreEvents.map((e) => e.name))];
    throw new Error(
      invoked.length
        ? `agent invoked core tools but none SUCCEEDED (failed: ${failed.join(", ") || "n/a"}). ` +
            `The sidecar reached the LLM but could not reach dikw-core — the "fetch failed" chat bug. ` +
            `In a proxied dev/live setup the sidecar must honor VITE_DIKW_PROXY_TARGET ` +
            `(server/agent/http.ts applyDevProxyTarget).`
        : `agent turn invoked no core tool (saw: ${
            toolEvents.map((e) => e.name).join(", ") || "none"
          }). Expected one of ${[...CORE_TOOLS].join("/")}.`,
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
    `[agent] core tools succeeded: ${succeeded.join(", ")} | trace waterfall: ${spanCount} spans across ${traces.invocations.length} invocations`,
  );
  console.log(
    `\n[agent] ✓ agent↔core verified: core tools succeeded over the live core.${
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
