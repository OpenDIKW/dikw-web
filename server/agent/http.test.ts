// @vitest-environment node
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSessionService, createEvent } from "@google/adk";
import type { Session } from "@google/adk";
import { createAgentHandler, maintenanceEndpoint } from "./http";
import { AdkSessionStore } from "./adkSessionStore";
import { SpanStore } from "./spanStore";
import type { AgentRunner } from "./runtime";

const APP_NAME = "dikw-web";
const USER_ID = "demo";

describe("maintenanceEndpoint", () => {
  it("maps each supported maintenance action to its core endpoint", () => {
    expect(maintenanceEndpoint("ingest")).toBe("/v1/ingest");
    expect(maintenanceEndpoint("synth")).toBe("/v1/synth");
    expect(maintenanceEndpoint("lint_propose")).toBe("/v1/lint/propose");
  });

  it("throws on an unknown action (e.g. a stale distill proposal) instead of silently routing", () => {
    expect(() => maintenanceEndpoint("distill" as never)).toThrow(/unknown maintenance action/);
  });
});

describe("agent HTTP sidecar", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
    vi.unstubAllGlobals();
  });

  function makeStore() {
    const sessionService = new DatabaseSessionService("sqlite://:memory:");
    const store = new AdkSessionStore({ sessionService, appName: APP_NAME, userId: USER_ID });
    return { sessionService, store };
  }

  async function appendEvent(sessionService: DatabaseSessionService, sessionId: string, event: ReturnType<typeof createEvent>) {
    const session = (await sessionService.getSession({
      appName: APP_NAME,
      userId: USER_ID,
      sessionId
    })) as Session;
    await sessionService.appendEvent({ session, event });
  }

  async function listen(handler: ReturnType<typeof createAgentHandler>): Promise<string> {
    const server = createServer(handler);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not bind to a TCP port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("creates sessions, streams message events, reopens history, and deletes sessions", async () => {
    const { sessionService, store } = makeStore();
    const runInputs: Array<{ coreUrl?: string; token?: string }> = [];
    const runner: AgentRunner = {
      async runMessage({ sessionId, coreUrl, token, onEvent }) {
        runInputs.push({ coreUrl, token });

        // Persist the turn as ADK events so the reopen projection sees it.
        await appendEvent(
          sessionService,
          sessionId,
          createEvent({ author: "user", content: { role: "user", parts: [{ text: "What is DIKW?" }] } })
        );
        await appendEvent(
          sessionService,
          sessionId,
          createEvent({
            author: "dikw_agent",
            content: {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    id: "tool-1",
                    name: "retrieve_knowledge",
                    response: {
                      page_refs: [
                        { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge", score: 0.9 }
                      ]
                    }
                  }
                }
              ]
            }
          })
        );
        await appendEvent(
          sessionService,
          sessionId,
          createEvent({ author: "dikw_agent", content: { role: "model", parts: [{ text: "Layered answer." }] } })
        );
        await store.finalizeTurn(sessionId);

        // Emit the frozen NDJSON wire sequence.
        await onEvent({
          type: "tool_event",
          sessionId,
          event: {
            id: "tool-1",
            type: "tool_call",
            name: "retrieve_knowledge",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z"
          }
        });
        await onEvent({ type: "message_delta", sessionId, delta: "Layered answer." });
        await onEvent({
          type: "source",
          sessionId,
          source: { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" }
        });
        await onEvent({ type: "agent_end", sessionId });
      }
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    const stream = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is DIKW?", coreUrl: "http://127.0.0.1:8765", token: "core-token" })
    });
    const events = (await stream.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });

    expect(events.map((event) => event.type)).toEqual(["tool_event", "message_delta", "source", "agent_end"]);
    expect(runInputs).toEqual([{ coreUrl: "http://127.0.0.1:8765", token: "core-token" }]);

    const reopened = (await (await fetch(`${baseUrl}/sessions/${created.id}`)).json()) as {
      messages: Array<{ role: string; content: string }>;
      sources: Array<{ path: string }>;
      toolEvents: Array<{ id: string }>;
    };
    expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(reopened.toolEvents[0]).toMatchObject({ id: "tool-1" });
    expect(reopened.sources[0].path).toBe("knowledge/architecture.md");

    const summaries = (await (await fetch(`${baseUrl}/sessions`)).json()) as Array<{ id: string; messageCount: number }>;
    expect(summaries).toEqual([expect.objectContaining({ id: created.id, messageCount: 2 })]);

    await fetch(`${baseUrl}/sessions/${created.id}`, { method: "DELETE" });
    expect(await (await fetch(`${baseUrl}/sessions`)).json()).toEqual([]);
  });

  it("confirms a maintenance proposal by firing the core endpoint and recording the task id", async () => {
    const { sessionService, store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called in this test");
      }
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    // Seed a pending proposal with a known id.
    await appendEvent(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        content: {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "pr-1",
                name: "propose_maintenance_action",
                response: { proposal: { action: "ingest", description: "d", params: {} } }
              }
            }
          ]
        }
      })
    );

    // runMaintenanceProposal uses global fetch to hit core; stub it. We then talk to
    // the sidecar over a raw node http client so the stub does not intercept that call.
    const coreFetch = vi.fn(async () => Response.json({ task_id: "t-1" }));
    vi.stubGlobal("fetch", coreFetch);

    let confirmed: { proposals: Array<{ id: string; status: string; taskId?: string }> };
    try {
      const res = await nodeFetch(`${baseUrl}/sessions/${created.id}/proposals/pr-1/confirm`, {
        method: "POST",
        body: JSON.stringify({ coreUrl: "http://127.0.0.1:8765", token: "core-token" })
      });
      confirmed = JSON.parse(res) as { proposals: Array<{ id: string; status: string; taskId?: string }> };
    } finally {
      vi.unstubAllGlobals();
    }

    expect(coreFetch).toHaveBeenCalledTimes(1);
    const calledUrl = (coreFetch.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toBe("http://127.0.0.1:8765/v1/ingest");
    const proposal = confirmed.proposals.find((p) => p.id === "pr-1");
    expect(proposal).toMatchObject({ status: "succeeded", taskId: "t-1" });
  });

  it("rejects agent messages that do not include a core URL", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called without coreUrl");
      }
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    const response = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is DIKW?" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "coreUrl is required" }
    });
  });

  it("serves session traces from the injected span store and an empty view without one", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called for traces");
      }
    };
    const spanStore = new SpanStore();

    const created = (await (async () => {
      const baseUrl = await listen(createAgentHandler({ store, runner, spanStore }));
      const session = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
      spanStore.record({
        traceId: "t1",
        spanId: "sp1",
        parentSpanId: null,
        name: "call_llm",
        startTimeMs: 1_000,
        durationMs: 200,
        status: "ok",
        attributes: { "gen_ai.request.model": "MiniMax-M3" },
        sessionId: session.id,
        invocationId: "inv-1",
        tokensInput: 42,
        tokensOutput: 7
      });
      const traces = (await (await fetch(`${baseUrl}/sessions/${session.id}/traces`)).json()) as {
        sessionId: string;
        invocations: Array<{ invocationId: string; spans: Array<{ name: string; tokensInput?: number }> }>;
      };
      expect(traces.sessionId).toBe(session.id);
      expect(traces.invocations).toHaveLength(1);
      expect(traces.invocations[0].invocationId).toBe("inv-1");
      expect(traces.invocations[0].spans[0]).toMatchObject({ name: "call_llm", tokensInput: 42 });
      return session;
    })());

    // Without a span store, the route returns an empty view (never 404).
    const baseUrl2 = await listen(createAgentHandler({ store, runner }));
    const empty = (await (await fetch(`${baseUrl2}/sessions/${created.id}/traces`)).json()) as {
      sessionId: string;
      invocations: unknown[];
    };
    expect(empty).toEqual({ sessionId: created.id, invocations: [] });
  });

  it("renames sessions through PATCH and rejects invalid titles", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called when renaming");
      }
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    const renamedResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Project Review" })
    });
    const renamed = (await renamedResponse.json()) as { title: string };

    expect(renamedResponse.status).toBe(200);
    expect(renamed.title).toBe("Project Review");
    await expect((await fetch(`${baseUrl}/sessions`)).json()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: "Project Review" })
    ]);

    const invalidResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " })
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "session title is required" }
    });
  });
});

// Minimal Node http client used where the proposal-confirm test stubs global fetch
// (so we cannot use fetch to talk to the sidecar). Returns the raw response body.
function nodeFetch(url: string, init: { method: string; body?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    import("node:http")
      .then(({ request }) => {
        const req = request(url, { method: init.method, headers: { "Content-Type": "application/json" } }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => resolve(text));
        });
        req.on("error", reject);
        if (init.body) {
          req.write(init.body);
        }
        req.end();
      })
      .catch(reject);
  });
}
