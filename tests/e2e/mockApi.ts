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
          sources: [{ path: "wiki/concepts/architecture.md", title: "Architecture", layer: "wiki" }]
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
            path: `wiki/concepts/auto-scroll-source-${index + 1}.md`,
            title: `Auto Scroll Source ${index + 1}`,
            layer: "wiki"
          }))
        : [{ path: `wiki/concepts/architecture-${turnNumber}.md`, title: `Architecture ${turnNumber}`, layer: "wiki" }];
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
