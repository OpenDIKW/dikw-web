// @vitest-environment node
import { createServer, request, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createServer as createViteServer } from "vite";
import { createApplicationPlugins } from "@opendikw/web-server/vite";
import { createWebRuntime, type ApplicationProfile } from "@opendikw/web-server/runtime";
import { startFakeIdp } from "../auth/fakeIdp.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "dikw-profile-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "dist"));
  await writeFile(join(cwd, "dist/index.html"), "<!doctype html><title>Profile fixture</title>");
  return cwd;
}

function cookie(response: Response, name: string) {
  return (
    response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${name}=`))
      ?.split(";")[0] ?? ""
  );
}

it("enforces MB capabilities after OIDC roles and isolates applications, users and server credentials", async () => {
  const coreRequests: Array<{ path: string; authorization?: string }> = [];
  let started: () => void;
  const pendingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let stallPageReads = false;
  let pageStarted: () => void;
  let pageDisconnected: () => void;
  let waitingPages = 0;
  let disconnectedPages = 0;
  const pendingPageStarted = new Promise<void>((resolve) => {
    pageStarted = resolve;
  });
  const pendingPageDisconnected = new Promise<void>((resolve) => {
    pageDisconnected = resolve;
  });
  const coreServer = createServer((req, res) => {
    coreRequests.push({ path: req.url!, authorization: req.headers.authorization });
    if (req.url === "/v1/tasks/pending/events") {
      started();
      return;
    }
    if (stallPageReads && req.url?.startsWith("/v1/base/pages/")) {
      res.once("close", () => {
        if (++disconnectedPages === 2) pageDisconnected();
      });
      if (++waitingPages === 2) pageStarted();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: "sources/paper.md",
        title: "Paper",
        body: "Shared evidence",
        assets: [],
      }),
    );
  });
  const core = await listen(coreServer);
  const modelCalls: Array<{ tools?: Array<{ name: string }>; system?: string; stream?: boolean }> =
    [];
  let agentTurns = 0;
  const model = await listen(
    createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as (typeof modelCalls)[number];
      modelCalls.push(body);
      if (!body.stream) {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id: "fixture",
            type: "message",
            role: "assistant",
            model: "fixture",
            content: [{ type: "text", text: "Translated fixture" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      const send = (value: Record<string, unknown>) =>
        res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      send({
        type: "message_start",
        message: {
          id: `fixture-${agentTurns}`,
          type: "message",
          role: "assistant",
          model: "fixture",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      const tool = stallPageReads || agentTurns++ === 0;
      send({
        type: "content_block_start",
        index: 0,
        content_block: tool
          ? { type: "tool_use", id: "read-1", name: "read_page", input: {} }
          : { type: "text", text: "" },
      });
      send({
        type: "content_block_delta",
        index: 0,
        delta: tool
          ? { type: "input_json_delta", partial_json: JSON.stringify({ path: "sources/paper.md" }) }
          : { type: "text_delta", text: "Evidence verified." },
      });
      send({ type: "content_block_stop", index: 0 });
      send({
        type: "message_delta",
        delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      send({ type: "message_stop" });
      res.end();
    }),
  );
  const idp = await startFakeIdp({
    clientId: "profile-fixture",
    clientSecret: "fixture-client",
    refreshTokens: true,
  });
  cleanups.push(() => idp.close());

  async function application(profile: ApplicationProfile) {
    const cwd = await workspace();
    const url = await listen(
      createServer((req, res) => {
        void runtime.handler(req, res);
      }),
    );
    const runtime = await createWebRuntime({
      appId: profile === "mbweb" ? "dikw-mbweb" : "dikw-web",
      profile,
      cwd,
      env: {
        NODE_ENV: "production",
        DIKW_WEB_CORE_ID: "shared-fixture",
        DIKW_WEB_AUTH_MODE: "oidc",
        DIKW_WEB_PUBLIC_URL: url,
        DIKW_WEB_OIDC_ISSUER: idp.issuer,
        DIKW_WEB_OIDC_CLIENT_ID: "profile-fixture",
        DIKW_WEB_OIDC_CLIENT_SECRET: "fixture-client",
        DIKW_WEB_SESSION_SECRET: (profile === "mbweb" ? "m" : "w").repeat(32),
        DIKW_WEB_ROLE_VIEWER: "viewer",
        DIKW_WEB_ROLE_EDITOR: "editor",
        DIKW_CORE_URL: core,
        DIKW_SERVER_TOKEN: "server-fixture-token",
        DIKW_AGENT_API_KEY: "fixture-only",
        DIKW_AGENT_BASE_URL: model,
        DIKW_AGENT_MODEL: "fixture",
      },
    });
    cleanups.push(() => runtime.close());
    const prefix = profile === "mbweb" ? "dikw_mbweb" : "dikw";
    async function signIn(sub: string, role = "editor") {
      const login = await fetch(`${url}/web/auth/login`, { redirect: "manual" });
      const approved = idp.approve(login.headers.get("location")!, { sub, roles: [role] });
      const response = await fetch(
        `${url}/web/auth/callback?code=${approved.code}&state=${encodeURIComponent(approved.state)}`,
        { redirect: "manual", headers: { cookie: cookie(login, `${prefix}_login`) } },
      );
      expect(response.status).toBe(302);
      return cookie(response, `${prefix}_session`);
    }
    function send(path: string, session: string, method = "GET", body?: unknown) {
      return fetch(`${url}${path}`, {
        redirect: "manual",
        method,
        headers: {
          cookie: session,
          origin: url,
          "content-type": "application/json",
          authorization: "Bearer browser-forgery",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    return { url, send, signIn, close: () => runtime.close() };
  }
  const mb = await application("mbweb");
  const workbench = await application("workbench");
  // Release fixture sockets first if a shutdown regression makes the test fail.
  cleanups.push(async () => coreServer.closeAllConnections());
  const alice = await mb.signIn("alice");
  const bob = await mb.signIn("bob", "viewer");
  const workCookie = await workbench.signIn("alice");
  expect(await (await mb.send("/web/auth/me", alice)).json()).toMatchObject({
    issuer: idp.issuer,
    coreId: "shared-fixture",
    user: { sub: "alice" },
    role: "editor",
  });
  const workMe = await (await workbench.send("/web/auth/me", workCookie)).json();
  expect(workMe).not.toHaveProperty("coreId");
  expect((await mb.send("/web/auth/me", workCookie)).status).toBe(401);
  expect((await workbench.send("/web/auth/me", alice)).status).toBe(401);
  expect((await mb.send("/v1/base/pages/sources%2Fpaper.md", bob)).status).toBe(200);
  expect(coreRequests.at(-1)).toEqual({
    path: "/v1/base/pages/sources/paper.md",
    authorization: "Bearer server-fixture-token",
  });
  expect((await mb.send("/v1/ingest", bob, "POST", {})).status).toBe(403);
  expect((await mb.send("/v1/ingest", alice, "POST", {})).status).toBe(200);
  const before = coreRequests.length;
  for (const [method, path] of [
    ["POST", "/v1/lint/apply"],
    ["GET", "/v1/tasks"],
    ["POST", "/agent/sessions/a/proposals/p/confirm"],
    ["GET", "/agent/sessions/a/traces"],
    ["GET", "/web/new-api"],
  ]) {
    expect((await mb.send(path, alice, method, method === "POST" ? {} : undefined)).status).toBe(
      403,
    );
  }
  expect(coreRequests).toHaveLength(before);
  expect((await workbench.send("/v1/lint/apply", workCookie, "POST", {})).status).toBe(200);
  // Node's raw HTTP API preserves malformed paths that fetch would normalize.
  const malformed = await new Promise<number>((resolve) => {
    const req = request(
      mb.url,
      { path: "/agent/sessions/a/proposals/p/../messages", headers: { cookie: alice } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.end();
  });
  expect(malformed).toBe(403);
  const created = await mb.send("/agent/sessions", alice, "POST", {});
  const session = (await created.json()) as { id: string };
  expect(created.status).toBe(201);
  expect((await mb.send(`/agent/sessions/${session.id}`, bob)).status).toBe(404);
  expect((await workbench.send(`/agent/sessions/${session.id}`, workCookie)).status).toBe(404);
  const stream = await mb.send(`/agent/sessions/${session.id}/messages`, alice, "POST", {
    message: "Read the paper",
    coreUrl: "http://127.0.0.1:9",
    token: "forged-core-token",
  });
  const events = (await stream.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(
    events.some((event) => event.type === "message_delta" && event.delta === "Evidence verified."),
  ).toBe(true);
  expect(events.some((event) => event.type === "error" || event.type === "proposal")).toBe(false);
  expect(coreRequests.at(-1)).toEqual({
    path: "/v1/base/pages/sources%2Fpaper.md",
    authorization: "Bearer server-fixture-token",
  });
  const call = modelCalls.find((item) => item.stream)!;
  expect(call.tools?.map((tool) => tool.name)).not.toContain("propose_maintenance_action");
  expect(call.system).not.toContain("Maintenance actions");
  const submitted = await mb.send("/web/translate/submit", alice, "POST", {
    blocks: ["Hello fixture"],
    targetLang: "zh",
  });
  expect(submitted.status).toBe(202);
  const job = (await submitted.json()) as { jobId: string };
  expect((await mb.send(`/web/translate/jobs/${job.jobId}`, alice)).status).toBe(200);
  expect((await mb.send(`/web/translate/jobs/${job.jobId}`, bob)).status).toBe(404);
  expect((await mb.send(`/web/translate/jobs/${job.jobId}/cancel`, bob, "POST")).status).toBe(404);
  expect((await workbench.send(`/web/translate/jobs/${job.jobId}`, workCookie)).status).toBe(404);
  const pending = mb.send("/v1/tasks/pending/events", alice).catch(() => undefined);
  await pendingStarted;
  const waitingSession = (await (await mb.send("/agent/sessions", alice, "POST", {})).json()) as {
    id: string;
  };
  agentTurns = 0;
  stallPageReads = true;
  const waitingAgents = await Promise.all(
    [1, 2].map(() =>
      mb.send(`/agent/sessions/${waitingSession.id}/messages`, alice, "POST", {
        message: "Read the paper",
      }),
    ),
  );
  const pendingAgents = waitingAgents.map((response) => response.text().catch(() => undefined));
  await pendingPageStarted;
  await mb.close();
  await pending;
  await Promise.all(pendingAgents);
  await pendingPageDisconnected;
  expect((await mb.send("/agent/sessions", alice)).status).toBe(503);
});

it("closes an admitted Agent request that has not finished sending its body", async () => {
  const cwd = await workspace();
  const runtime = await createWebRuntime({
    cwd,
    appId: "dikw-web",
    profile: "workbench",
    env: {
      DIKW_WEB_AUTH_MODE: "off",
      DIKW_AGENT_API_KEY: "fixture-only",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
      DIKW_AGENT_MODEL: "fixture",
    },
  });
  cleanups.push(() => runtime.close());
  let admit: () => void;
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const url = await listen(
    createServer((req, res) => {
      void runtime.handler(req, res);
      admit();
    }),
  );
  const partial = request(`${url}/agent/sessions/waiting/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const disconnected = new Promise<void>((resolve) => {
    partial.on("error", () => {});
    partial.once("close", resolve);
  });
  partial.write('{"message":');
  cleanups.push(async () => {
    partial.destroy();
    await disconnected;
  });
  await admitted;
  await runtime.close();
  await disconnected;
});

it("applies the MB guard before Vite's Core proxy and sidecars", async () => {
  let forwarded = 0;
  const core = await listen(
    createServer((_req, res) => {
      forwarded++;
      res.end("core fixture");
    }),
  );
  const cwd = await workspace();
  const vite = await createViteServer({
    configFile: false,
    root: cwd,
    plugins: createApplicationPlugins({ profile: "mbweb" }),
    server: { host: "127.0.0.1", port: 0, proxy: { "/v1": core } },
  });
  await vite.listen();
  cleanups.push(() => vite.close());
  const url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`;
  expect((await fetch(`${url}/v1/health`)).status).toBe(200);
  expect(forwarded).toBe(1);
  for (const path of ["/v1/tasks", "/agent/sessions/a/traces", "/web/unknown"])
    expect((await fetch(`${url}${path}`)).status).toBe(403);
  expect(forwarded).toBe(1);
});
