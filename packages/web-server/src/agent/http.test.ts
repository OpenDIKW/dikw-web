// @vitest-environment node
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSessionService, createEvent } from "@google/adk";
import type { Session } from "@google/adk";
import { applyDevProxyTarget, createAgentHandler, maintenanceEndpoint } from "./http";
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

describe("applyDevProxyTarget (dev sidecar mirrors the Vite /v1 proxy)", () => {
  it("returns the core URL unchanged when no proxy target is configured", () => {
    expect(applyDevProxyTarget("http://127.0.0.1:8765", undefined)).toBe("http://127.0.0.1:8765");
  });

  it("rewrites the default core URL to the proxy target (browser keeps serverUrl at the default to use the same-origin proxy)", () => {
    expect(applyDevProxyTarget("http://127.0.0.1:8765", "http://127.0.0.1:57609")).toBe(
      "http://127.0.0.1:57609",
    );
  });

  it("leaves a non-default core URL untouched (a custom serverUrl is reached directly, not via the proxy)", () => {
    expect(applyDevProxyTarget("https://core.example.com", "http://127.0.0.1:57609")).toBe(
      "https://core.example.com",
    );
  });

  it("falls back to the unrewritten core URL when the proxy target is malformed", () => {
    expect(applyDevProxyTarget("http://127.0.0.1:8765", "127.0.0.1:57609")).toBe(
      "http://127.0.0.1:8765",
    );
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

  async function appendEvent(
    sessionService: DatabaseSessionService,
    sessionId: string,
    event: ReturnType<typeof createEvent>,
    userId = USER_ID,
  ) {
    const session = (await sessionService.getSession({
      appName: APP_NAME,
      userId,
      sessionId,
    })) as Session;
    await sessionService.appendEvent({ session, event });
  }

  function clientCookieOf(response: Response): string {
    return (
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("dikw_client="))
        ?.split(";")[0] ?? ""
    );
  }

  function anonUserId(cookie: string): string {
    return `anon:${cookie.slice("dikw_client=".length)}`;
  }

  async function listen(handler: ReturnType<typeof createAgentHandler>): Promise<string> {
    const server = createServer(handler);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
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
      async runMessage({ sessionId, userId, coreUrl, token, onEvent }) {
        runInputs.push({ coreUrl, token });

        // Persist the turn as ADK events so the reopen projection sees it.
        await appendEvent(
          sessionService,
          sessionId,
          createEvent({
            author: "user",
            content: { role: "user", parts: [{ text: "What is DIKW?" }] },
          }),
          userId,
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
                        {
                          path: "knowledge/architecture.md",
                          title: "Architecture",
                          layer: "knowledge",
                          score: 0.9,
                        },
                      ],
                    },
                  },
                },
              ],
            },
          }),
          userId,
        );
        await appendEvent(
          sessionService,
          sessionId,
          createEvent({
            author: "dikw_agent",
            content: { role: "model", parts: [{ text: "Layered answer." }] },
          }),
          userId,
        );
        await store.forUser(userId ?? USER_ID).finalizeTurn(sessionId);

        // Emit the frozen NDJSON wire sequence.
        await onEvent({
          type: "tool_event",
          sessionId,
          event: {
            id: "tool-1",
            type: "tool_call",
            name: "retrieve_knowledge",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z",
          },
        });
        await onEvent({ type: "message_delta", sessionId, delta: "Layered answer." });
        await onEvent({
          type: "source",
          sessionId,
          source: { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" },
        });
        await onEvent({ type: "agent_end", sessionId });
      },
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const cookie = clientCookieOf(createdRes);
    const created = (await createdRes.json()) as { id: string };
    const stream = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        message: "What is DIKW?",
        coreUrl: "https://core.example.com",
        token: "core-token",
      }),
    });
    const events = (await stream.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });

    expect(events.map((event) => event.type)).toEqual([
      "tool_event",
      "message_delta",
      "source",
      "agent_end",
    ]);
    expect(runInputs).toEqual([{ coreUrl: "https://core.example.com", token: "core-token" }]);

    const reopened = (await (
      await fetch(`${baseUrl}/sessions/${created.id}`, { headers: { cookie } })
    ).json()) as {
      messages: Array<{ role: string; content: string }>;
      sources: Array<{ path: string }>;
      toolEvents: Array<{ id: string }>;
    };
    expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(reopened.toolEvents[0]).toMatchObject({ id: "tool-1" });
    expect(reopened.sources[0].path).toBe("knowledge/architecture.md");

    const summaries = (await (
      await fetch(`${baseUrl}/sessions`, { headers: { cookie } })
    ).json()) as Array<{
      id: string;
      messageCount: number;
    }>;
    expect(summaries).toEqual([expect.objectContaining({ id: created.id, messageCount: 2 })]);

    await fetch(`${baseUrl}/sessions/${created.id}`, { method: "DELETE", headers: { cookie } });
    expect(await (await fetch(`${baseUrl}/sessions`, { headers: { cookie } })).json()).toEqual([]);
  });

  it("routes a default-URL message through the injected dev proxy target so the sidecar reaches the live core", async () => {
    const { store } = makeStore();
    const runInputs: Array<{ coreUrl?: string }> = [];
    const runner: AgentRunner = {
      async runMessage({ sessionId, coreUrl, onEvent }) {
        runInputs.push({ coreUrl });
        await onEvent({ type: "agent_end", sessionId });
      },
    };
    const baseUrl = await listen(
      createAgentHandler({ store, runner, devProxyTarget: "http://127.0.0.1:57609" }),
    );

    const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const cookie = clientCookieOf(createdRes);
    const created = (await createdRes.json()) as { id: string };
    // The browser sends the DEFAULT core URL (its /v1 reads ride the same-origin
    // Vite proxy); the sidecar must mirror that proxy and reach the live core.
    const stream = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ message: "hi", coreUrl: "http://127.0.0.1:8765", token: "t" }),
    });
    await stream.text(); // drain so runMessage has run

    expect(runInputs).toEqual([{ coreUrl: "http://127.0.0.1:57609" }]);
  });

  it("confirms a maintenance proposal by firing the core endpoint and recording the task id", async () => {
    const { sessionService, store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called in this test");
      },
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const cookie = clientCookieOf(createdRes);
    const created = (await createdRes.json()) as { id: string };
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
                response: { proposal: { action: "ingest", description: "d", params: {} } },
              },
            },
          ],
        },
      }),
      anonUserId(cookie),
    );

    // runMaintenanceProposal uses global fetch to hit core; stub it. We then talk to
    // the sidecar over a raw node http client so the stub does not intercept that call.
    const coreFetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ task_id: "t-1" }),
    );
    vi.stubGlobal("fetch", coreFetch);

    let confirmed: { proposals: Array<{ id: string; status: string; taskId?: string }> };
    try {
      const res = await nodeFetch(`${baseUrl}/sessions/${created.id}/proposals/pr-1/confirm`, {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ coreUrl: "https://core.example.com", token: "core-token" }),
      });
      confirmed = JSON.parse(res) as {
        proposals: Array<{ id: string; status: string; taskId?: string }>;
      };
    } finally {
      vi.unstubAllGlobals();
    }

    expect(coreFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = coreFetch.mock.calls[0];
    expect(calledUrl).toBe("https://core.example.com/v1/ingest");
    expect(calledInit.redirect).toBe("error");
    const proposal = confirmed.proposals.find((p) => p.id === "pr-1");
    expect(proposal).toMatchObject({ status: "succeeded", taskId: "t-1" });
  });

  it("rejects agent messages that do not include a core URL", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called without coreUrl");
      },
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const cookie = clientCookieOf(createdRes);
    const created = (await createdRes.json()) as { id: string };
    const response = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ message: "What is DIKW?" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "coreUrl is required" },
    });
  });

  it("serves session traces from the injected span store and an empty view without one", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called for traces");
      },
    };
    const spanStore = new SpanStore();

    const { session: created, cookie } = await (async () => {
      const baseUrl = await listen(createAgentHandler({ store, runner, spanStore }));
      const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
      const clientCookie = clientCookieOf(createdRes);
      const session = (await createdRes.json()) as { id: string };
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
        tokensOutput: 7,
      });
      const traces = (await (
        await fetch(`${baseUrl}/sessions/${session.id}/traces`, {
          headers: { cookie: clientCookie },
        })
      ).json()) as {
        sessionId: string;
        invocations: Array<{
          invocationId: string;
          spans: Array<{ name: string; tokensInput?: number }>;
        }>;
      };
      expect(traces.sessionId).toBe(session.id);
      expect(traces.invocations).toHaveLength(1);
      expect(traces.invocations[0].invocationId).toBe("inv-1");
      expect(traces.invocations[0].spans[0]).toMatchObject({ name: "call_llm", tokensInput: 42 });
      return { session, cookie: clientCookie };
    })();

    // Without a span store, the route returns an empty view (never 404).
    const baseUrl2 = await listen(createAgentHandler({ store, runner }));
    const empty = (await (
      await fetch(`${baseUrl2}/sessions/${created.id}/traces`, { headers: { cookie } })
    ).json()) as {
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
      },
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));

    const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const cookie = clientCookieOf(createdRes);
    const created = (await createdRes.json()) as { id: string };
    const renamedResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ title: "Project Review" }),
    });
    const renamed = (await renamedResponse.json()) as { title: string };

    expect(renamedResponse.status).toBe(200);
    expect(renamed.title).toBe("Project Review");
    await expect(
      (await fetch(`${baseUrl}/sessions`, { headers: { cookie } })).json(),
    ).resolves.toEqual([expect.objectContaining({ id: created.id, title: "Project Review" })]);

    const invalidResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ title: "   " }),
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "session title is required" },
    });
  });

  it("answers 404 (not 500) for a session that does not exist", async () => {
    const { store } = makeStore();
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called");
      },
    };
    const baseUrl = await listen(createAgentHandler({ store, runner }));
    const response = await fetch(`${baseUrl}/sessions/missing`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "session not found" },
    });
  });

  describe("auth-off hardening", () => {
    it.each([
      ["http://127.0.0.1:8765"],
      ["http://localhost:8765"],
      ["http://localhost.:8765"],
      ["http://169.254.169.254/latest/meta-data"],
      ["http://metadata.google.internal"],
      ["http://host.docker.internal:8765"],
      ["http://redis:6379"],
      ["http://10.0.0.1:8765"],
      ["http://172.16.0.5:8765"],
      ["http://192.168.1.10:8765"],
      ["http://[::1]:8765"],
      ["http://[::ffff:127.0.0.1]:8765"],
      ["http://[::127.0.0.1]:8765"],
      ["http://[64:ff9b::127.0.0.1]:8765"],
      ["http://[ff02::1]:8765"],
      ["http://core.local:8765"],
      ["https://user:pass@core.example.com"],
      ["https://core.example.com/other?x="],
      ["file:///etc/passwd"],
    ])(
      "rejects private, loopback, or unsafe caller coreUrl %s on messages and proposal confirm",
      async (badCoreUrl) => {
        const { store } = makeStore();
        const runMessage = vi.fn();
        const baseUrl = await listen(createAgentHandler({ store, runner: { runMessage } }));
        const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
        const cookie = clientCookieOf(createdRes);
        const created = (await createdRes.json()) as { id: string };

        const msgRes = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ message: "hi", coreUrl: badCoreUrl }),
        });
        expect(msgRes.status).toBe(400);
        expect(await msgRes.json()).toMatchObject({ error: { code: "invalid_request" } });

        const confirmRes = await fetch(`${baseUrl}/sessions/${created.id}/proposals/p-1/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ coreUrl: badCoreUrl }),
        });
        expect(confirmRes.status).toBe(400);
        expect(await confirmRes.json()).toMatchObject({ error: { code: "invalid_request" } });
        expect(runMessage).not.toHaveBeenCalled();
      },
    );

    it("still rejects non-default private/loopback coreUrl even when devProxyTarget is set", async () => {
      const { store } = makeStore();
      const runMessage = vi.fn();
      const baseUrl = await listen(
        createAgentHandler({
          store,
          runner: { runMessage },
          devProxyTarget: "http://127.0.0.1:57609",
        }),
      );
      const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
      const cookie = clientCookieOf(createdRes);
      const created = (await createdRes.json()) as { id: string };

      for (const badCoreUrl of ["http://127.0.0.1:6379", "http://169.254.169.254"]) {
        const res = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ message: "hi", coreUrl: badCoreUrl }),
        });
        expect(res.status, badCoreUrl).toBe(400);
      }
      expect(runMessage).not.toHaveBeenCalled();
    });

    it("does not share sessions across unauthenticated clients or expose legacy demo sessions", async () => {
      const { store } = makeStore();
      const legacy = await store.createSession();
      const runner: AgentRunner = {
        async runMessage() {
          throw new Error("runner should not be called");
        },
      };
      const baseUrl = await listen(createAgentHandler({ store, runner }));

      const clientARes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
      const cookieA = clientCookieOf(clientARes);
      expect(cookieA).toMatch(/^dikw_client=[a-f0-9]{32}$/);
      const setCookieHeader = clientARes.headers.getSetCookie().join(";");
      expect(setCookieHeader).toContain("HttpOnly");
      expect(setCookieHeader).toContain("Path=/agent");
      const sessionA = (await clientARes.json()) as { id: string };

      // Cookie-less GET /sessions returns [] without minting a cookie (prevents
      // concurrent first-load GET/POST races from clobbering the new client cookie).
      const initialList = await fetch(`${baseUrl}/sessions`);
      expect(initialList.status).toBe(200);
      expect(await initialList.json()).toEqual([]);
      expect(initialList.headers.getSetCookie()).toEqual([]);

      // Cookie-less 404 does not mint a cookie either.
      const missingRes = await fetch(`${baseUrl}/sessions/${sessionA.id}`);
      expect(missingRes.status).toBe(404);
      expect(missingRes.headers.getSetCookie()).toEqual([]);

      // Client A sees only its own session, never the legacy demo session.
      const listA = (await (
        await fetch(`${baseUrl}/sessions`, { headers: { cookie: cookieA } })
      ).json()) as Array<{ id: string }>;
      expect(listA.map((s) => s.id)).toEqual([sessionA.id]);
      expect(
        (await fetch(`${baseUrl}/sessions/${legacy.id}`, { headers: { cookie: cookieA } })).status,
      ).toBe(404);

      // Another client (no cookie, different cookie, or forged `demo` cookie) sees neither.
      for (const headers of [
        {},
        { cookie: "dikw_client=demo" },
        { cookie: `dikw_client=${"b".repeat(32)}` },
      ] as Array<Record<string, string>>) {
        expect(await (await fetch(`${baseUrl}/sessions`, { headers })).json()).toEqual([]);
        expect((await fetch(`${baseUrl}/sessions/${sessionA.id}`, { headers })).status).toBe(404);
        expect(
          (await fetch(`${baseUrl}/sessions/${sessionA.id}`, { method: "DELETE", headers })).status,
        ).toBe(404);
        expect((await fetch(`${baseUrl}/sessions/${legacy.id}`, { headers })).status).toBe(404);
      }
    });

    it("blocks agent runs and proposal confirms with 401 when requirePrincipal is enabled without a subject", async () => {
      const { store } = makeStore();
      const runMessage = vi.fn();
      const baseUrl = await listen(
        createAgentHandler({ store, runner: { runMessage }, requirePrincipal: true }),
      );
      const createdRes = await fetch(`${baseUrl}/sessions`, { method: "POST" });
      const cookie = clientCookieOf(createdRes);
      const created = (await createdRes.json()) as { id: string };

      const msgRes = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ message: "hi", coreUrl: "https://core.example.com" }),
      });
      expect(msgRes.status).toBe(401);
      expect(await msgRes.json()).toMatchObject({ error: { code: "auth_required" } });

      const confirmRes = await fetch(`${baseUrl}/sessions/${created.id}/proposals/p-1/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ coreUrl: "https://core.example.com" }),
      });
      expect(confirmRes.status).toBe(401);
      expect(await confirmRes.json()).toMatchObject({ error: { code: "auth_required" } });

      // Auth check runs before body parsing and without minting cookies on 401.
      const malformedRes = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      });
      expect(malformedRes.status).toBe(401);
      expect(await malformedRes.json()).toMatchObject({ error: { code: "auth_required" } });
      expect(malformedRes.headers.getSetCookie()).toEqual([]);
      expect(runMessage).not.toHaveBeenCalled();
    });
  });

  describe("auth mode (issue #200)", () => {
    const serverCore = { coreUrl: "http://core.internal:8765", token: "server-token" };
    // Stand-in for the auth gate: the caller's OIDC `sub` arrives as a header.
    const subjectFor = (req: IncomingMessage) => String(req.headers["x-test-user"]);
    const as = (user: string, init: RequestInit = {}): RequestInit => ({
      ...init,
      headers: { "Content-Type": "application/json", "x-test-user": user },
    });

    function recordingRunner() {
      const calls: Array<{ userId?: string; coreUrl: string; token?: string }> = [];
      const runner: AgentRunner = {
        async runMessage({ sessionId, userId, coreUrl, token, onEvent }) {
          calls.push({ userId, coreUrl, token });
          await onEvent({ type: "agent_end", sessionId });
        },
      };
      return { calls, runner };
    }

    it("isolates two users' sessions on every session route", async () => {
      const { store } = makeStore();
      const { calls, runner } = recordingRunner();
      const baseUrl = await listen(
        createAgentHandler({ store, runner, spanStore: new SpanStore(), subjectFor, serverCore }),
      );
      const created = (await (
        await fetch(`${baseUrl}/sessions`, as("alice", { method: "POST" }))
      ).json()) as { id: string };
      const id = created.id;

      expect(await (await fetch(`${baseUrl}/sessions`, as("bob"))).json()).toEqual([]);
      const routes: Array<[string, string, string?]> = [
        ["GET", `/sessions/${id}`],
        ["GET", `/sessions/${id}/traces`],
        ["PATCH", `/sessions/${id}`, JSON.stringify({ title: "Mine now" })],
        ["POST", `/sessions/${id}/abort`],
        ["POST", `/sessions/${id}/messages`, JSON.stringify({ message: "hi" })],
        ["POST", `/sessions/${id}/proposals/p-1/reject`],
        ["POST", `/sessions/${id}/proposals/p-1/confirm`, "{}"],
        ["DELETE", `/sessions/${id}`],
      ];
      for (const [method, path, body] of routes) {
        const response = await fetch(`${baseUrl}${path}`, as("bob", { method, body }));
        expect(response.status, `${method} ${path}`).toBe(404);
      }
      expect(calls).toEqual([]);

      // Alice still owns an untouched session and can keep using it.
      expect(await (await fetch(`${baseUrl}/sessions`, as("alice"))).json()).toEqual([
        expect.objectContaining({ id, title: "New chat" }),
      ]);
      const stream = await fetch(
        `${baseUrl}/sessions/${id}/messages`,
        as("alice", { method: "POST", body: JSON.stringify({ message: "hi" }) }),
      );
      await stream.text();
      expect(calls).toEqual([{ userId: "oidc:alice", ...serverCore }]);
      const deleted = await fetch(`${baseUrl}/sessions/${id}`, as("alice", { method: "DELETE" }));
      expect(deleted.status).toBe(204);
    });

    it("uses the server-held core connection and ignores a request-supplied one", async () => {
      const { sessionService, store } = makeStore();
      const { calls, runner } = recordingRunner();
      const baseUrl = await listen(createAgentHandler({ store, runner, subjectFor, serverCore }));
      const created = (await (
        await fetch(`${baseUrl}/sessions`, as("alice", { method: "POST" }))
      ).json()) as { id: string };

      const stream = await fetch(
        `${baseUrl}/sessions/${created.id}/messages`,
        as("alice", {
          method: "POST",
          body: JSON.stringify({
            message: "hi",
            coreUrl: "http://169.254.169.254",
            token: "browser-token",
          }),
        }),
      );
      await stream.text();
      expect(calls).toEqual([{ userId: "oidc:alice", ...serverCore }]);

      // A confirmed maintenance proposal also goes to the server-held core.
      const session = (await sessionService.getSession({
        appName: APP_NAME,
        userId: "oidc:alice",
        sessionId: created.id,
      })) as Session;
      await sessionService.appendEvent({
        session,
        event: createEvent({
          author: "dikw_agent",
          content: {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "pr-1",
                  name: "propose_maintenance_action",
                  response: { proposal: { action: "synth", description: "d", params: {} } },
                },
              },
            ],
          },
        }),
      });
      const coreFetch = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({ task_id: "t-2" }),
      );
      vi.stubGlobal("fetch", coreFetch);
      try {
        await nodeFetch(`${baseUrl}/sessions/${created.id}/proposals/pr-1/confirm`, {
          method: "POST",
          body: JSON.stringify({ coreUrl: "http://169.254.169.254", token: "browser-token" }),
          headers: { "x-test-user": "alice" },
        });
      } finally {
        vi.unstubAllGlobals();
      }
      expect(coreFetch).toHaveBeenCalledTimes(1);
      const [url, init] = coreFetch.mock.calls[0];
      expect(url).toBe("http://core.internal:8765/v1/synth");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer server-token");
    });

    it("preserves a configured path prefix on serverCore.coreUrl when confirming a maintenance proposal", async () => {
      const { sessionService, store } = makeStore();
      const { runner } = recordingRunner();
      const prefixedCore = {
        coreUrl: "https://core.example.com/core",
        token: "server-token",
      };
      const baseUrl = await listen(
        createAgentHandler({ store, runner, subjectFor, serverCore: prefixedCore }),
      );
      const created = (await (
        await fetch(`${baseUrl}/sessions`, as("alice", { method: "POST" }))
      ).json()) as { id: string };
      const session = (await sessionService.getSession({
        appName: APP_NAME,
        userId: "oidc:alice",
        sessionId: created.id,
      })) as Session;
      await sessionService.appendEvent({
        session,
        event: createEvent({
          author: "dikw_agent",
          content: {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "pr-prefixed",
                  name: "propose_maintenance_action",
                  response: { proposal: { action: "synth", description: "d", params: {} } },
                },
              },
            ],
          },
        }),
      });
      const coreFetch = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({ task_id: "t-prefixed" }),
      );
      vi.stubGlobal("fetch", coreFetch);
      try {
        await nodeFetch(`${baseUrl}/sessions/${created.id}/proposals/pr-prefixed/confirm`, {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "x-test-user": "alice" },
        });
      } finally {
        vi.unstubAllGlobals();
      }
      expect(coreFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = coreFetch.mock.calls[0];
      expect(calledUrl).toBe("https://core.example.com/core/v1/synth");
      expect(calledInit.redirect).toBe("error");
      expect((calledInit.headers as Record<string, string>).Authorization).toBe(
        "Bearer server-token",
      );
    });

    it("lets the configured legacy owner see and continue the pre-auth sessions", async () => {
      const { store } = makeStore();
      const legacy = await store.createSession();
      const { calls, runner } = recordingRunner();
      const baseUrl = await listen(
        createAgentHandler({
          store,
          runner,
          subjectFor,
          serverCore,
          legacySessionsOwner: "owner-sub",
        }),
      );

      expect(await (await fetch(`${baseUrl}/sessions`, as("owner-sub"))).json()).toEqual([
        expect.objectContaining({ id: legacy.id }),
      ]);
      const stream = await fetch(
        `${baseUrl}/sessions/${legacy.id}/messages`,
        as("owner-sub", { method: "POST", body: JSON.stringify({ message: "hi" }) }),
      );
      await stream.text();
      // ADK is driven under the user id the session is actually stored under.
      expect(calls).toEqual([{ userId: USER_ID, ...serverCore }]);

      expect(await (await fetch(`${baseUrl}/sessions`, as("someone-else"))).json()).toEqual([]);
      expect((await fetch(`${baseUrl}/sessions/${legacy.id}`, as("someone-else"))).status).toBe(
        404,
      );
    });

    it.each([
      ["no legacy owner is configured", undefined],
      ["someone else is the legacy owner", "owner-sub"],
    ])(
      "keeps the pre-auth sessions from a subject that is literally `demo` when %s",
      async (_label, legacySessionsOwner) => {
        const { store } = makeStore();
        const legacy = await store.createSession();
        const { runner } = recordingRunner();
        const baseUrl = await listen(
          createAgentHandler({ store, runner, subjectFor, serverCore, legacySessionsOwner }),
        );

        expect(await (await fetch(`${baseUrl}/sessions`, as(USER_ID))).json()).toEqual([]);
        expect((await fetch(`${baseUrl}/sessions/${legacy.id}`, as(USER_ID))).status).toBe(404);
      },
    );
  });
});

// Minimal Node http client used where the proposal-confirm test stubs global fetch
// (so we cannot use fetch to talk to the sidecar). Returns the raw response body.
function nodeFetch(
  url: string,
  init: { method: string; body?: string; headers?: Record<string, string> },
): Promise<string> {
  return new Promise((resolve, reject) => {
    import("node:http")
      .then(({ request }) => {
        const req = request(
          url,
          {
            method: init.method,
            headers: { "Content-Type": "application/json", ...init.headers },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              text += chunk;
            });
            res.on("end", () => resolve(text));
          },
        );
        req.on("error", reject);
        if (init.body) {
          req.write(init.body);
        }
        req.end();
      })
      .catch(reject);
  });
}
