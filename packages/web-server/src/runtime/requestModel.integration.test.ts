// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { APIConnectionTimeoutError, APIUserAbortError } from "@anthropic-ai/sdk";
import { createWebRuntime } from "./createWebRuntime.js";
import { AuthSessionStore } from "../auth/sessionStore.js";
import { SessionValidationError, type SessionIdentity } from "../auth/sessionValidation.js";
import {
  ModelResolutionError,
  type ModelResolver,
  type OpenAICompletionRequest,
} from "./requestModel.js";
import { TranslatorClient, TranslatorClientError } from "../web/translatorClient.js";
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const reply = (text: string) => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1000, completion_tokens: 2 },
});
async function setup(
  resolveModel: ModelResolver,
  options: {
    compaction?: boolean;
    live?: (identity: Readonly<SessionIdentity>) => void;
    custom?: (
      req: IncomingMessage,
      res: ServerResponse,
      runtime: Awaited<ReturnType<typeof createWebRuntime>>,
    ) => Promise<boolean>;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "dikw-request-model-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "dist"));
  await writeFile(join(cwd, "dist/index.html"), "fixture");
  const secret = "fixture-session-secret-at-least-32-characters";
  const store = new AuthSessionStore({ path: join(cwd, "auth.sqlite"), secret });
  cleanups.push(() => store.close());
  const ids = Object.fromEntries(
    ["alice", "bob"].map((sub) => [
      sub,
      store.create(
        {
          sub,
          role: "editor",
          idToken: "fixture",
          accessToken: "fixture-token-" + sub,
          authenticatedAt: 1700000000,
        },
        3600,
      ),
    ]),
  );
  const checks: string[] = [];
  let coreCalls = 0;
  const core = createServer((_req, res) => {
    coreCalls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ path: "sources/a.md", title: "Paper", body: "evidence", assets: [] }));
  });
  await new Promise<void>((r) => core.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => core.close(() => r())));
  const runtime = await createWebRuntime({
    appId: "dikw-mbweb",
    profile: "mbweb",
    cwd,
    resolveModel,
    validateSession: async (identity) => {
      checks.push(identity.sub);
      options.live?.(identity);
      return { role: "editor" };
    },
    env: {
      NODE_ENV: "production",
      DIKW_WEB_AUTH_MODE: "oidc",
      DIKW_WEB_CORE_ID: "fixture-core",
      DIKW_WEB_PUBLIC_URL: "https://kb.example",
      DIKW_WEB_OIDC_ISSUER: "https://iam.example",
      DIKW_WEB_OIDC_CLIENT_ID: "kb-fixture",
      DIKW_WEB_OIDC_CLIENT_SECRET: "fixture-client-secret",
      DIKW_WEB_SESSION_SECRET: secret,
      DIKW_WEB_ROLE_EDITOR: "kb_editor",
      DIKW_CORE_URL: `http://127.0.0.1:${(core.address() as { port: number }).port}`,
      DIKW_SERVER_TOKEN: "fixture-core-key",
      DIKW_AGENT_SESSIONS_DIR: cwd,
      DIKW_AGENT_COMPACTION_ENABLED: options.compaction ? "true" : "false",
      DIKW_AGENT_CONTEXT_WINDOW: "100",
      DIKW_AGENT_COMPACTION_RETENTION: "1",
    },
  });
  cleanups.push(() => runtime.close());
  const server = createServer(async (req, res) => {
    if (options.custom && (await options.custom(req, res, runtime))) return;
    await runtime.handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function call(sub: string, path: string, body?: unknown, model?: string) {
    return fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: `dikw_mbweb_session=${ids[sub]}`,
        origin: "https://kb.example",
        "Content-Type": "application/json",
        ...(model ? { "X-DIKW-Model": model } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
  return {
    runtime,
    call,
    store,
    ids,
    checks,
    coreCalls: () => coreCalls,
    async session(sub: string) {
      return (await (await call(sub, "/agent/sessions", {})).json()).id as string;
    },
  };
}
it("isolates concurrent identities, retains tool calls and compaction on the same per-turn transport", async () => {
  const calls: Array<{ sub: string; model: string; body: OpenAICompletionRequest }> = [];
  const resolved: Array<{ sub: string; model: string }> = [];
  const test = await setup(
    async ({ identity, request, feature }) => {
      expect(feature).toBe("agent");
      expect(identity.authenticatedAt).toBe(1700000000);
      const model = String(request.headers["x-dikw-model"]);
      resolved.push({ sub: identity.sub, model });
      return {
        model,
        async complete(body) {
          calls.push({ sub: identity.sub, model, body });
          await pause(identity.sub === "alice" ? 10 : 1);
          if (!body.messages.some((m) => m.role === "system")) return reply("PRIVATE_SUMMARY");
          if (!body.messages.some((m) => m.role === "tool"))
            return {
              choices: [
                {
                  message: {
                    content: null,
                    reasoning_content: "HIDDEN_REASONING",
                    tool_calls: [
                      {
                        id: "read1",
                        type: "function",
                        function: { name: "read_page", arguments: '{"path":"sources/a.md"}' },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 1000, completion_tokens: 2 },
            };
          expect(body.messages.find((m) => m.tool_calls?.length)?.reasoning_content).toBe(
            "HIDDEN_REASONING",
          );
          return reply(identity.sub + ":" + model);
        },
      };
    },
    { compaction: true },
  );
  const a = await test.session("alice"),
    b = await test.session("bob");
  const answers = await Promise.all([
    test
      .call("alice", `/agent/sessions/${a}/messages`, { message: "read paper" }, "a-model")
      .then((r) => r.text()),
    test
      .call("bob", `/agent/sessions/${b}/messages`, { message: "read paper" }, "b-model")
      .then((r) => r.text()),
  ]);
  expect(answers[0]).toContain("alice:a-model");
  expect(answers[0]).not.toContain("bob:b-model");
  expect(answers[1]).toContain("bob:b-model");
  expect(answers.join()).not.toContain("HIDDEN_REASONING");
  expect(answers.join()).not.toContain("fixture-token");
  expect(answers[0]).toContain('"type":"tool_event"');
  expect(test.coreCalls()).toBeGreaterThan(0);
  await test.call("alice", `/agent/sessions/${a}/messages`, { message: "follow up" }, "a-model");
  expect(calls.some((c) => !c.body.messages.some((m) => m.role === "system"))).toBe(true);
  expect(resolved).toHaveLength(3);
  expect(calls.length).toBeGreaterThan(resolved.length);
  for (const c of calls) expect(c.model).toBe(c.sub === "alice" ? "a-model" : "b-model");
  const history = await (await test.call("alice", `/agent/sessions/${a}`)).text();
  expect(history).not.toContain("HIDDEN_REASONING");
  expect(history).not.toContain("PRIVATE_SUMMARY");
  expect((await test.call("bob", `/agent/sessions/${a}`)).status).toBe(404);
});
it("detached translation revalidates original identity on every batch and stops after revocation", async () => {
  let active = true,
    calls = 0;
  const checks: number[] = [];
  const test = await setup(
    async ({ identity, feature }) => {
      expect(feature).toBe("translation");
      return {
        model: "alice-private",
        async complete(body) {
          calls++;
          expect(identity.sub).toBe("alice");
          active = false;
          return reply(body.messages[1].content!);
        },
      };
    },
    {
      live(identity) {
        checks.push(identity.authenticatedAt);
        if (!active) throw new SessionValidationError(403);
      },
    },
  );
  const response = await test.call("alice", "/web/translate/submit", {
    blocks: Array.from({ length: 13 }, (_, i) => "中文段落" + i),
    targetLang: "en",
  });
  expect(response.status).toBe(202);
  const { jobId } = await response.json();
  await pause(25);
  // Revocation deletes the old local session. A new authorized login can inspect
  // its same-user failed job, while the original worker never calls the model again.
  active = true;
  test.ids.alice = test.store.create(
    {
      sub: "alice",
      role: "editor",
      idToken: "fixture",
      accessToken: "fixture-token-alice",
      authenticatedAt: 1700000000,
    },
    3600,
  );
  const job = await (await test.call("alice", `/web/translate/jobs/${jobId}`)).json();
  expect(job.status).toBe("failed");
  expect(calls).toBe(1);
  expect(checks.every((v) => v === 1700000000)).toBe(true);
  expect((await test.call("bob", `/web/translate/jobs/${jobId}`)).status).toBe(404);
  expect(JSON.stringify(job)).not.toContain("fixture-token");
});
it("cancellation reaches the original detached transport signal", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  let aborted = false;
  const test = await setup(async () => ({
    model: "m",
    async complete(_body, signal) {
      started();
      return new Promise((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("PRIVATE_ABORT"));
          },
          { once: true },
        );
      });
    },
  }));
  const response = await test.call("alice", "/web/translate/submit", {
    blocks: ["中文"],
    targetLang: "en",
  });
  const { jobId } = await response.json();
  await ready;
  await test.call("alice", `/web/translate/jobs/${jobId}/cancel`, {});
  await pause();
  expect(aborted).toBe(true);
  const job = await (await test.call("alice", `/web/translate/jobs/${jobId}`)).json();
  expect(JSON.stringify(job)).not.toContain("PRIVATE_ABORT");
});
it("runtime closes while translation model selection is pending", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  let selectionSignal: AbortSignal | undefined;
  let release!: () => void;
  const test = await setup(async ({ signal }) => {
    selectionSignal = signal;
    started();
    return new Promise((_resolve, reject) => {
      release = () => reject(new Error("PRIVATE_PENDING_MODEL"));
      signal?.addEventListener("abort", release, { once: true });
    });
  });
  const response = test.call("alice", "/web/translate/submit", {
    blocks: ["原文"],
    targetLang: "en",
  });
  await ready;
  const closing = test.runtime.close();
  try {
    expect(selectionSignal?.aborted).toBe(true);
    expect(
      await Promise.race([closing.then(() => "closed"), pause(1000).then(() => "pending")]),
    ).toBe("closed");
    const rejected = await response;
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).not.toContain("PRIVATE_PENDING_MODEL");
  } finally {
    // Ensure the pre-fix failure also releases the real HTTP request and cleanup.
    release();
    await response;
    await closing;
  }
});
it.each(["stop", "length"])(
  "surfaces a safe error for reasoning-only Agent completion (%s)",
  async (finishReason) => {
    const test = await setup(async () => ({
      model: "reasoning-fixture",
      async complete() {
        return {
          choices: [
            {
              message: { content: null, reasoning_content: "PRIVATE_HIDDEN_REASONING" },
              finish_reason: finishReason,
            },
          ],
        };
      },
    }));
    const session = await test.session("alice");
    const response = await test.call("alice", `/agent/sessions/${session}/messages`, {
      message: "Answer this question",
    });
    const wire = await response.text();
    expect(wire).toContain('"type":"error"');
    expect(wire).not.toContain('"type":"message_delta"');
    expect(wire).not.toContain("PRIVATE_HIDDEN_REASONING");
    expect(await (await test.call("alice", `/agent/sessions/${session}`)).text()).not.toContain(
      "PRIVATE_HIDDEN_REASONING",
    );
  },
);
it.each([
  ["AbortError", 1],
  ["APIUserAbortError", 1],
  ["TypeError", 3],
  ["APIConnectionTimeoutError", 3],
] as const)(
  "preserves %s retry classification through the authenticated model wrapper",
  async (name, expectedCalls) => {
    let calls = 0;
    const job = new AbortController();
    const test = await setup(
      async () => ({
        model: "wrapped-model",
        async complete() {
          calls++;
          if (calls < 3) {
            const message = "Bearer PRIVATE_WRAPPED_TRANSPORT";
            if (name === "APIUserAbortError") throw new APIUserAbortError({ message });
            if (name === "APIConnectionTimeoutError")
              throw new APIConnectionTimeoutError({ message });
            if (name === "AbortError") throw new DOMException(message, name);
            throw new TypeError(message);
          }
          return reply("Translated");
        },
      }),
      {
        custom: async (req, res, runtime) => {
          if (req.url !== "/wrapped-translation") return false;
          const transport = await runtime.resolveModelFor!(req, res, "translation", job.signal);
          if (!transport) return true;
          const client = new TranslatorClient({
            apiKey: "",
            baseUrl: "",
            model: transport.model,
            requestModel: transport,
            signal: job.signal,
            maxRetries: 2,
            retryBaseMs: 0,
          });
          try {
            res.end(JSON.stringify({ blocks: await client.translate(["原文"], "en") }));
          } catch (error) {
            expect(error).toBeInstanceOf(TranslatorClientError);
            const failure = error as TranslatorClientError;
            res.statusCode = 503;
            res.end(JSON.stringify({ code: failure.code, message: failure.message }));
          }
          return true;
        },
      },
    );
    const response = await test.call("alice", "/wrapped-translation", {});
    const wire = await response.text();
    expect(calls).toBe(expectedCalls);
    expect(job.signal.aborted).toBe(false);
    expect(wire).not.toContain("PRIVATE_WRAPPED_TRANSPORT");
    if (expectedCalls === 1) {
      expect(response.status).toBe(503);
      expect(JSON.parse(wire)).toMatchObject({ code: "translator_api" });
    } else {
      expect(response.status).toBe(200);
      expect(JSON.parse(wire)).toEqual({ blocks: ["Translated"] });
    }
  },
);
it("application model hooks do not accept forged subjects and reject local logout before transport", async () => {
  let calls = 0;
  const test = await setup(
    async ({ identity }) => ({
      model: identity.sub,
      async complete() {
        calls++;
        return reply("ok");
      },
    }),
    {
      custom: async (req, res, runtime) => {
        if (req.url !== "/own") return false;
        const model = await runtime.resolveModelFor!(req, res, "knowledge");
        if (!model) return true;
        test.store.delete(test.ids.alice);
        try {
          await model.complete({
            model: model.model,
            stream: false,
            messages: [{ role: "user", content: "x" }],
          });
          res.end("bad");
        } catch (error) {
          expect(error).toBeInstanceOf(ModelResolutionError);
          res.statusCode = 401;
          res.end("denied");
        }
        return true;
      },
    },
  );
  expect((await test.call("alice", "/own", { subject: "bob" })).status).toBe(401);
  expect(calls).toBe(0);
});
it("keeps the same login through access-token rotation and ignores an injected third identity", async () => {
  const observed: Array<{ sub: string; token: string; at: number }> = [];
  const test = await setup(
    async () => ({
      model: "pinned-choice",
      async complete(_body, _signal, fresh) {
        observed.push({ sub: fresh!.sub, token: fresh!.accessToken, at: fresh!.authenticatedAt });
        return reply("ok");
      },
    }),
    {
      custom: async (req, res, runtime) => {
        if (req.url !== "/rotation") return false;
        const model = await runtime.resolveModelFor!(req, res, "knowledge");
        if (!model) return true;
        const body = {
          model: model.model,
          stream: false as const,
          messages: [{ role: "user" as const, content: "x" }],
        };
        await model.complete(body);
        const current = test.store.get(test.ids.alice)!;
        test.store.update(test.ids.alice, { ...current, accessToken: "fixture-refreshed-alice" });
        await model.complete(body, undefined, {
          issuer: "evil",
          clientId: "evil",
          sub: "bob",
          accessToken: "forged",
          authenticatedAt: 1,
        });
        res.end("ok");
        return true;
      },
    },
  );
  expect((await test.call("alice", "/rotation", {})).status).toBe(200);
  expect(observed).toEqual([
    { sub: "alice", token: "fixture-token-alice", at: 1700000000 },
    { sub: "alice", token: "fixture-refreshed-alice", at: 1700000000 },
  ]);
});
it.each(["subject", "login-time"])(
  "rejects %s replacement even when the opaque session id stays the same",
  async (kind) => {
    let calls = 0;
    const test = await setup(
      async () => ({
        model: "pinned",
        async complete() {
          calls++;
          return reply("bad");
        },
      }),
      {
        custom: async (req, res, runtime) => {
          if (req.url !== "/replacement") return false;
          const model = await runtime.resolveModelFor!(req, res, "knowledge");
          if (!model) return true;
          const before = test.store.get(test.ids.alice)!;
          test.store.update(test.ids.alice, {
            ...before,
            ...(kind === "subject" ? { sub: "bob" } : { authenticatedAt: 1700000010 }),
          });
          try {
            await model.complete({
              model: "pinned",
              stream: false,
              messages: [{ role: "user", content: "x" }],
            });
            res.end("bad");
          } catch (error) {
            expect(error).toBeInstanceOf(ModelResolutionError);
            res.statusCode = 401;
            res.end("denied");
          }
          return true;
        },
      },
    );
    expect((await test.call("alice", "/replacement", {})).status).toBe(401);
    expect(calls).toBe(0);
  },
);
it("model catalog callbacks receive only gate-verified identity and remain server-side", async () => {
  let invoked = 0;
  const test = await setup(
    async () => {
      throw new Error("resolver not needed for catalog");
    },
    {
      custom: async (req, res, runtime) => {
        if (req.url !== "/catalog") return false;
        const value = await runtime.withModelIdentity!(req, res, async (identity) => {
          invoked++;
          expect(identity.accessToken).toBe("fixture-token-alice");
          return { user: identity.sub, models: ["safe-model"] };
        });
        if (value) res.end(JSON.stringify(value));
        return true;
      },
    },
  );
  const result = await (await test.call("alice", "/catalog")).text();
  expect(result).toContain('"user":"alice"');
  expect(result).not.toContain("fixture-token");
  expect(invoked).toBe(1);
});
it("still compacts long history when a compatible provider omits usage", async () => {
  let summaries = 0;
  const test = await setup(
    async () => ({
      model: "missing-usage",
      async complete(body) {
        const summary = !body.messages.some((m) => m.role === "system");
        if (summary) summaries++;
        return {
          choices: [
            {
              message: { content: summary ? "summary" : "Long answer. ".repeat(150) },
              finish_reason: "stop",
            },
          ],
        };
      },
    }),
    { compaction: true },
  );
  const id = await test.session("alice");
  for (const message of ["first", "second", "third"])
    await (
      await test.call("alice", `/agent/sessions/${id}/messages`, { message }, "missing-usage")
    ).text();
  expect(summaries).toBeGreaterThan(0);
});
