import type { Page } from "@playwright/test";
import {
  bulkTaskEventsFixture,
  choCqaAssetId,
  graphResultFixture,
  healthFixture,
  infoFixture,
  onePxPngBase64,
  retrieveEventsFixture,
  statusFixture,
  taskEventsFixture,
  taskRowsFixture,
  wikiPageBodiesFixture,
  wikiPageLinksFixture,
  wikiPageProvenanceFixture,
  wikiPagesFixture
} from "./fixtures";

export async function mockDikwApi(page: Page) {
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    await route.fulfill({ contentType: "text/css", body: "" });
  });
  await page.route("https://fonts.gstatic.com/**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  // Branding is fetched at app bootstrap; force a 404 so e2e always exercises
  // the default OpenDIKW branding regardless of any stray local public/config.json.
  await page.route("**/config.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });

  let hasAgentSession = false;
  let agentSession = {
    id: "session-1",
    title: "New chat",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    messageCount: 0,
    lastMessagePreview: "",
    messages: [] as Array<{ id: string; role: string; content: string; createdAt: string }>,
    toolEvents: [] as Array<{ id: string; type: string; name: string; status: string; createdAt: string }>,
    sources: [] as Array<{
      path: string;
      title: string;
      layer?: string | null;
      excerpt?: string | null;
      score?: number | null;
      kind?: "core" | "web";
    }>,
    proposals: [] as unknown[]
  };

  await page.route("**/agent/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // Trace-only sessions: the hidden #trace page lists/opens these and renders
    // their span waterfalls. Kept separate from the chat `session-1` flow so the
    // chat e2e's session list is unaffected.
    const traceDetailMatch = /^\/agent\/sessions\/(trace-[^/]+)$/.exec(path);
    if (traceDetailMatch) {
      const session = traceSessions[traceDetailMatch[1]];
      await route.fulfill(session ? { json: session } : { status: 404, body: "unknown trace session" });
      return;
    }
    const traceWaterfallMatch = /^\/agent\/sessions\/(trace-[^/]+)\/traces$/.exec(path);
    if (traceWaterfallMatch) {
      const view = traceViews[traceWaterfallMatch[1]];
      await route.fulfill({
        json: view ?? { sessionId: traceWaterfallMatch[1], invocations: [] }
      });
      return;
    }

    if (path === "/agent/sessions") {
      if (route.request().method() === "POST") {
        hasAgentSession = true;
        await route.fulfill({
          json: agentSession
        });
        return;
      }
      await route.fulfill({ json: hasAgentSession ? [toSessionSummary(agentSession)] : [] });
      return;
    }

    if (path === "/agent/sessions/session-1") {
      if (route.request().method() === "DELETE") {
        hasAgentSession = false;
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { title?: string };
        agentSession = {
          ...agentSession,
          title: String(body.title ?? "").trim(),
          updatedAt: "2026-05-13T00:00:02.000Z"
        };
      } else if (!hasAgentSession) {
        hasAgentSession = true;
        agentSession = {
          ...agentSession,
          title: "What is DIKW?",
          updatedAt: "2026-05-13T00:00:01.000Z",
          messageCount: 2,
          lastMessagePreview: "Layered answer.",
          messages: [
            { id: "m1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z" },
            { id: "m2", role: "assistant", content: "Layered answer.", createdAt: "2026-05-13T00:00:01.000Z" }
          ],
          toolEvents: [
            {
              id: "tool-1",
              type: "tool_call",
              name: "retrieve_knowledge",
              status: "succeeded",
              createdAt: "2026-05-13T00:00:00.500Z"
            }
          ],
          sources: [{ path: "knowledge/concepts/architecture.md", title: "Architecture", layer: "knowledge" }]
        };
      }
      await route.fulfill({ json: agentSession });
      return;
    }

    if (path === "/agent/sessions/session-1/messages") {
      const body = route.request().postDataJSON() as { message?: string };
      const userMessage = String(body.message ?? "What is DIKW?");
      const turnNumber = Math.floor(agentSession.messages.length / 2) + 1;
      const isWebTools = userMessage.toLowerCase().includes("web tools demo");
      if (isWebTools) {
        const assistantMessage = "Found two web sources and fetched one page.";
        const toolEvents = [
          {
            id: `tool-${turnNumber}-search`,
            type: "tool_call",
            name: "web_search",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z",
            input: { q: "DIKW" },
            output: {
              query: "DIKW",
              results: [
                { title: "Example A", url: "https://example.com/a", description: "external snippet a" },
                { title: "Example B", url: "https://example.com/b", description: "external snippet b" }
              ]
            }
          },
          {
            id: `tool-${turnNumber}-fetch`,
            type: "tool_call",
            name: "web_fetch",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:01.000Z",
            input: { url: "https://example.com/a" },
            output: { url: "https://example.com/a", content: "page body", truncated: false }
          }
        ];
        const sources = [
          {
            path: "https://example.com/a",
            title: "Example A",
            excerpt: "external snippet a",
            layer: null,
            score: null,
            kind: "web"
          },
          {
            path: "https://example.com/b",
            title: "Example B",
            excerpt: "external snippet b",
            layer: null,
            score: null,
            kind: "web"
          }
        ];
        agentSession = {
          ...agentSession,
          title: agentSession.title === "New chat" ? userMessage.slice(0, 40) : agentSession.title,
          updatedAt: "2026-05-13T00:00:03.000Z",
          messageCount: agentSession.messages.length + 2,
          lastMessagePreview: assistantMessage,
          messages: [
            ...agentSession.messages,
            { id: `m${turnNumber * 2 - 1}`, role: "user", content: userMessage, createdAt: "2026-05-13T00:00:00.000Z" },
            { id: `m${turnNumber * 2}`, role: "assistant", content: assistantMessage, createdAt: "2026-05-13T00:00:01.000Z" }
          ],
          toolEvents: [...agentSession.toolEvents, ...toolEvents],
          sources: [...agentSession.sources, ...sources]
        };
        await route.fulfill({
          contentType: "application/x-ndjson",
          body: [
            ...toolEvents.map((event) => JSON.stringify({ type: "tool_event", sessionId: "session-1", event })),
            JSON.stringify({ type: "message_delta", sessionId: "session-1", delta: assistantMessage }),
            ...sources.map((source) => JSON.stringify({ type: "source", sessionId: "session-1", source })),
            JSON.stringify({ type: "agent_end", sessionId: "session-1" })
          ].join("\n")
        });
        return;
      }
      const isAutoScrollStress = userMessage.toLowerCase().includes("auto-scroll stress");
      const assistantMessage = isAutoScrollStress
        ? Array.from(
            { length: 48 },
            (_, index) => `Auto scroll line ${turnNumber}-${index + 1}: evidence-backed chat output keeps growing.`
          ).join("\n\n")
        : "Layered answer.";
      const toolEvents = isAutoScrollStress
        ? Array.from({ length: 24 }, (_, index) => ({
            id: `tool-${turnNumber}-${index + 1}`,
            type: "tool_call",
            name: `retrieve_knowledge_${index + 1}`,
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z"
          }))
        : [
            {
              id: `tool-${turnNumber}`,
              type: "tool_call",
              name: "retrieve_knowledge",
              status: "succeeded",
              createdAt: "2026-05-13T00:00:00.500Z"
            }
          ];
      const sources = isAutoScrollStress
        ? Array.from({ length: 24 }, (_, index) => ({
            // Turn-distinct paths (like the tool ids above) so a later turn adds
            // net-new sources — the right rail dedups identical pages across turns.
            path: `knowledge/concepts/auto-scroll-source-${turnNumber}-${index + 1}.md`,
            title: `Auto Scroll Source ${turnNumber}-${index + 1}`,
            layer: "knowledge"
          }))
        : [{ path: `knowledge/concepts/architecture-${turnNumber}.md`, title: `Architecture ${turnNumber}`, layer: "knowledge" }];
      agentSession = {
        ...agentSession,
        title: agentSession.title === "New chat" ? userMessage.slice(0, 40) : agentSession.title,
        updatedAt: "2026-05-13T00:00:03.000Z",
        messageCount: agentSession.messages.length + 2,
        lastMessagePreview: assistantMessage,
        messages: [
          ...agentSession.messages,
          { id: `m${turnNumber * 2 - 1}`, role: "user", content: userMessage, createdAt: "2026-05-13T00:00:00.000Z" },
          { id: `m${turnNumber * 2}`, role: "assistant", content: assistantMessage, createdAt: "2026-05-13T00:00:01.000Z" }
        ],
        toolEvents: [...agentSession.toolEvents, ...toolEvents],
        sources: [...agentSession.sources, ...sources]
      };
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: [
          ...toolEvents.map((event) => JSON.stringify({ type: "tool_event", sessionId: "session-1", event })),
          JSON.stringify({ type: "message_delta", sessionId: "session-1", delta: assistantMessage }),
          ...sources.map((source) =>
            JSON.stringify({
              type: "source",
              sessionId: "session-1",
              source
            })
          ),
          JSON.stringify({ type: "agent_end", sessionId: "session-1" })
        ].join("\n")
      });
      return;
    }

    if (path === "/agent/sessions/session-1/abort") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({ status: 404, body: `No agent mock for ${path}` });
  });

  // /web/* — dikw-web's own sidecar namespace, separate from /agent/* and
  // /v1/*. Default to "mineru disabled" so legacy ImportPage tests don't
  // see network noise. Per-test routes can override this with their own
  // page.route() registered before navigation.
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: false, hasKey: false } });
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/v1/info") {
      await route.fulfill({ json: infoFixture });
      return;
    }
    if (path === "/v1/health") {
      await route.fulfill({ json: healthFixture });
      return;
    }
    if (path === "/v1/status") {
      await route.fulfill({ json: statusFixture });
      return;
    }
    if (path === "/v1/base/graph") {
      await route.fulfill({ json: graphResultFixture });
      return;
    }
    if (path === "/v1/base/pages") {
      const layer = url.searchParams.get("layer");
      // WisdomPage requests `layer=wisdom`; KnowledgePicker on edit requests
      // `layer=knowledge`. e2e specs only exercise the page chrome (heading,
      // filter, Starred chip), not list contents, so empty arrays are safe.
      // Wiki / Base specs continue to call with no layer filter and need the
      // full fixture.
      if (layer === "wisdom" || layer === "knowledge" || layer === "source") {
        await route.fulfill({ json: [] });
        return;
      }
      await route.fulfill({ json: wikiPagesFixture });
      return;
    }
    if (path.startsWith("/v1/base/pages/")) {
      const rest = decodeURIComponent(path.replace("/v1/base/pages/", ""));
      if (rest.endsWith("/provenance")) {
        const target = rest.replace(/\/provenance$/, "");
        const body = wikiPageProvenanceFixture[target] ?? { path: target, derived_from: [], derived_pages: [] };
        await route.fulfill({ json: body });
        return;
      }
      if (rest.endsWith("/links")) {
        const target = rest.replace(/\/links$/, "");
        const body = wikiPageLinksFixture[target] ?? { path: target, outgoing: [], incoming: [] };
        await route.fulfill({ json: body });
        return;
      }
      await route.fulfill({ json: wikiPageBodiesFixture[rest] });
      return;
    }
    if (path.startsWith("/v1/assets/")) {
      const assetId = path.replace("/v1/assets/", "");
      if (assetId === choCqaAssetId) {
        await route.fulfill({
          contentType: "image/png",
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
          body: Buffer.from(onePxPngBase64, "base64")
        });
        return;
      }
      await route.fulfill({ status: 404, body: `unknown asset ${assetId}` });
      return;
    }
    if (path === "/v1/tasks") {
      await route.fulfill({
        json: {
          tasks: taskRowsFixture.map((row) => ({
            task_id: row.task_id,
            op: row.op,
            status: row.status,
            created_at: row.created_at,
            started_at: row.started_at,
            finished_at: row.finished_at,
            params_digest: row.params_digest
          })),
          next_cursor: null,
          has_more: false
        }
      });
      return;
    }
    const taskDetailMatch = /^\/v1\/tasks\/([^/]+)$/.exec(path);
    if (taskDetailMatch) {
      const row = taskRowsFixture.find((task) => task.task_id === decodeURIComponent(taskDetailMatch[1]));
      await route.fulfill(row ? { json: row } : { status: 404, body: `unknown task ${taskDetailMatch[1]}` });
      return;
    }
    if (path === "/v1/tasks/eval-task-1/events") {
      const fromSeqRaw = url.searchParams.get("from_seq");
      const fromSeqParsed = fromSeqRaw === null ? 0 : Number(fromSeqRaw);
      const fromSeq = Number.isFinite(fromSeqParsed) && fromSeqParsed > 0 ? fromSeqParsed : 0;
      const lastSeq = taskEventsFixture.reduce(
        (max, event) => (typeof event.seq === "number" && event.seq > max ? event.seq : max),
        0
      );
      const events = taskEventsFixture.filter(
        (event) => typeof event.seq === "number" && event.seq >= fromSeq
      );
      await route.fulfill({
        json: {
          task_id: "eval-task-1",
          task_status: "succeeded",
          events,
          next_from_seq: lastSeq + 1,
          has_more: false,
          last_seq: lastSeq
        }
      });
      return;
    }
    if (path === "/v1/tasks/events-bulk-1/events") {
      const fromSeqRaw = url.searchParams.get("from_seq");
      const fromSeqParsed = fromSeqRaw === null ? 0 : Number(fromSeqRaw);
      const fromSeq = Number.isFinite(fromSeqParsed) && fromSeqParsed > 0 ? fromSeqParsed : 0;
      const lastSeq = bulkTaskEventsFixture.reduce(
        (max, event) => (typeof event.seq === "number" && event.seq > max ? event.seq : max),
        0
      );
      const events = bulkTaskEventsFixture.filter(
        (event) => typeof event.seq === "number" && event.seq >= fromSeq
      );
      await route.fulfill({
        json: {
          task_id: "events-bulk-1",
          task_status: "succeeded",
          events,
          next_from_seq: lastSeq + 1,
          has_more: false,
          last_seq: lastSeq
        }
      });
      return;
    }
    if (path === "/v1/retrieve") {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: retrieveEventsFixture.map((event) => JSON.stringify(event)).join("\n")
      });
      return;
    }

    await route.fulfill({ status: 404, body: `No mock for ${path}` });
  });
}

function toSessionSummary(session: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
}) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    lastMessagePreview: session.lastMessagePreview
  };
}

// --- #trace fixtures -------------------------------------------------------
// Two trace-only sessions served live to the hidden #trace page (separate from
// the chat session-1 flow). getSession returns the conversation; the /traces
// route returns a small SessionTraceView (invocation → spans waterfall).
const T0 = 1_717_488_000_000;
const traceIso = (offset: number) => new Date(T0 + offset).toISOString();

const traceSessions: Record<string, unknown> = {
  "trace-demo-architecture": {
    id: "trace-demo-architecture",
    title: "What is the DIKW architecture?",
    createdAt: traceIso(0),
    updatedAt: traceIso(4_200),
    messageCount: 2,
    lastMessagePreview: "DIKW stacks data → information → knowledge → wisdom…",
    messages: [
      { id: "m1", role: "user", content: "What is the DIKW architecture?", createdAt: traceIso(0) },
      {
        id: "m2",
        role: "assistant",
        content: "DIKW stacks data → information → knowledge → wisdom. The agent cites the source pages it read.",
        createdAt: traceIso(4_180)
      }
    ],
    toolEvents: [],
    sources: [],
    proposals: []
  },
  "trace-demo-wisdom": {
    id: "trace-demo-wisdom",
    title: "List the wisdom items",
    createdAt: traceIso(60_000),
    updatedAt: traceIso(61_900),
    messageCount: 2,
    lastMessagePreview: "There are 3 wisdom items in the base…",
    messages: [
      { id: "m1", role: "user", content: "List the wisdom items.", createdAt: traceIso(60_000) },
      {
        id: "m2",
        role: "assistant",
        content: "There are 3 wisdom items in the base: onboarding-playbook, retrieval-tuning, and review-cadence.",
        createdAt: traceIso(61_880)
      }
    ],
    toolEvents: [],
    sources: [],
    proposals: []
  }
};

const traceViews: Record<string, unknown> = {
  "trace-demo-architecture": {
    sessionId: "trace-demo-architecture",
    invocations: [
      {
        invocationId: "inv-arch-1",
        startTimeMs: T0,
        durationMs: 4_200,
        spans: [
          { spanId: "s0", parentSpanId: null, name: "invocation", startTimeMs: T0, durationMs: 4_200, status: "ok", attributes: {} },
          {
            spanId: "s1",
            parentSpanId: "s0",
            name: "call_llm",
            startTimeMs: T0 + 20,
            durationMs: 900,
            status: "ok",
            attributes: { "gen_ai.request.model": "MiniMax-M3" },
            tokensInput: 1_240,
            tokensOutput: 58
          },
          {
            spanId: "s2",
            parentSpanId: "s0",
            name: "execute_tool retrieve_knowledge",
            startTimeMs: T0 + 940,
            durationMs: 1_500,
            status: "ok",
            attributes: { "gen_ai.tool.name": "retrieve_knowledge" }
          }
        ]
      }
    ]
  },
  "trace-demo-wisdom": {
    sessionId: "trace-demo-wisdom",
    invocations: [
      {
        invocationId: "inv-wisdom-1",
        startTimeMs: T0 + 60_000,
        durationMs: 1_900,
        spans: [
          {
            spanId: "w0",
            parentSpanId: null,
            name: "invocation",
            startTimeMs: T0 + 60_000,
            durationMs: 1_900,
            status: "ok",
            attributes: {}
          },
          {
            spanId: "w1",
            parentSpanId: "w0",
            name: "execute_tool list_wisdom",
            startTimeMs: T0 + 60_300,
            durationMs: 410,
            status: "ok",
            attributes: { "gen_ai.tool.name": "list_wisdom" }
          }
        ]
      }
    ]
  }
};

const traceSessionSummaries = Object.values(traceSessions).map((session) =>
  toSessionSummary(session as Parameters<typeof toSessionSummary>[0])
);

/**
 * Overlay for the #trace page: makes `GET /agent/sessions` return the two
 * trace-only sessions. Registered AFTER mockDikwApi so it takes precedence for
 * the list endpoint (Playwright matches the most-recently-added route first).
 * Detail + /traces routes are already served by mockDikwApi.
 */
export async function mockTraceApi(page: Page) {
  await page.route("**/agent/sessions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: traceSessionSummaries });
      return;
    }
    await route.fallback();
  });
}
