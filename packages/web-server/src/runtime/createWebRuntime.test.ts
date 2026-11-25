// @vitest-environment node
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWebRuntime } from "@opendikw/web-server/runtime";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "dikw-runtime-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "build"));
  await writeFile(
    join(cwd, "build/index.html"),
    "<!doctype html><title>Independent application</title>",
  );
  return cwd;
}

it("accepts application-owned configuration and closes persistent sessions before restart", async () => {
  const cwd = await workspace();
  const options = {
    appId: "dikw-mbweb",
    profile: "mbweb",
    cwd,
    staticDir: "build",
    env: {
      DIKW_WEB_AUTH_MODE: "off",
      DIKW_AGENT_SESSIONS_DIR: "mb-sessions",
      DIKW_AGENT_API_KEY: "fixture-only",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
      DIKW_AGENT_MODEL: "fixture",
    },
  } as const;
  let runtime = await createWebRuntime(options);
  cleanups.push(() => runtime.close());
  const server = createServer((req, res) => {
    void runtime.handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  expect(await (await fetch(`${url}/`)).text()).toContain("Independent application");
  expect(await (await fetch(`${url}/web/auth/me`)).json()).toEqual({ enabled: false });
  expect((await fetch(`${url}/v1/tasks`, { headers: { accept: "text/html" } })).status).toBe(403);
  const created = await Promise.all([
    fetch(`${url}/agent/sessions`, { method: "POST" }),
    fetch(`${url}/agent/sessions`, { method: "POST" }),
  ]);
  expect(created.map((response) => response.status)).toEqual([201, 201]);
  const clientCookie =
    created[0].headers
      .getSetCookie()
      .find((value) => value.startsWith("dikw_client="))
      ?.split(";")[0] ?? "";
  expect(clientCookie).toMatch(/^dikw_client=[a-f0-9]{32}$/);
  const session = (await created[0].json()) as { id: string };
  expect(session.id).toBeTruthy();
  await runtime.close();
  await runtime.close();
  expect(await readdir(join(cwd, "mb-sessions"))).toContain("agent.sqlite");
  expect((await fetch(`${url}/agent/sessions`)).status).toBe(503);
  runtime = await createWebRuntime(options);
  const sessions = (await (
    await fetch(`${url}/agent/sessions`, { headers: { cookie: clientCookie } })
  ).json()) as Array<{ id: string }>;
  expect(sessions.map((item) => item.id)).toContain(session.id);
  // A different unauthenticated client does not share the session namespace.
  const otherClientSessions = (await (await fetch(`${url}/agent/sessions`)).json()) as Array<{
    id: string;
  }>;
  expect(otherClientSessions).toEqual([]);
});

it("requires a stable public Core identity and authentication for production MB", async () => {
  const cwd = await workspace();
  await expect(
    createWebRuntime({
      appId: "dikw-mbweb",
      profile: "mbweb",
      cwd,
      staticDir: "build",
      env: { NODE_ENV: "production" },
    }),
  ).rejects.toThrow("DIKW_WEB_CORE_ID");
  await expect(
    createWebRuntime({
      appId: "dikw-mbweb",
      profile: "mbweb",
      cwd,
      staticDir: "build",
      env: { NODE_ENV: "production", DIKW_WEB_CORE_ID: "shared-base" },
    }),
  ).rejects.toThrow("DIKW_WEB_AUTH_MODE");
});

it("requires OIDC for production workbench and any non-loopback bind host", async () => {
  const cwd = await workspace();
  await expect(
    createWebRuntime({
      appId: "dikw-web",
      profile: "workbench",
      cwd,
      staticDir: "build",
      env: { NODE_ENV: "production", DIKW_WEB_AUTH_MODE: "off" },
    }),
  ).rejects.toThrow("DIKW_WEB_AUTH_MODE=oidc");
  await expect(
    createWebRuntime({
      appId: "dikw-web",
      profile: "workbench",
      cwd,
      staticDir: "build",
      env: { NODE_ENV: "production" },
    }),
  ).rejects.toThrow("DIKW_WEB_AUTH_MODE=oidc");
  for (const host of ["0.0.0.0", "::", "10.0.0.5"]) {
    await expect(
      createWebRuntime({
        appId: "dikw-web",
        profile: "workbench",
        cwd,
        staticDir: "build",
        env: { DIKW_WEB_HOST: host, DIKW_WEB_AUTH_MODE: "off" },
      }),
    ).rejects.toThrow("non-loopback DIKW_WEB_HOST requires DIKW_WEB_AUTH_MODE=oidc");
  }
});

it("keeps server-held provider keys unused when auth is off", async () => {
  const cwd = await workspace();
  const runtime = await createWebRuntime({
    appId: "dikw-web",
    profile: "workbench",
    cwd,
    staticDir: "build",
    env: {
      DIKW_WEB_AUTH_MODE: "off",
      DIKW_AGENT_API_KEY: "fixture-llm-key",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
      DIKW_AGENT_MODEL: "fixture",
      DIKW_AGENT_TAVILY_API_KEY: "fixture-tavily-key",
      DIKW_AGENT_JINA_API_KEY: "fixture-jina-key",
      DIKW_WEB_MINERU_API_KEY: "fixture-mineru-key",
    },
  });
  cleanups.push(() => runtime.close());
  const server = createServer((req, res) => {
    void runtime.handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  expect(await (await fetch(`${url}/web/mineru/health`)).json()).toEqual({
    enabled: false,
    hasKey: false,
  });
  expect(await (await fetch(`${url}/web/translate/health`)).json()).toEqual({ enabled: false });

  const convert = await fetch(`${url}/web/mineru/convert?inputSha=${"a".repeat(64)}`, {
    method: "POST",
  });
  expect(convert.status).toBe(401);
  expect(await convert.json()).toMatchObject({ error: { code: "auth_required" } });

  const translate = await fetch(`${url}/web/translate/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks: ["hello"], targetLang: "zh" }),
  });
  expect(translate.status).toBe(401);
  expect(await translate.json()).toMatchObject({ error: { code: "auth_required" } });

  const created = await fetch(`${url}/agent/sessions`, { method: "POST" });
  const clientCookie =
    created.headers
      .getSetCookie()
      .find((value) => value.startsWith("dikw_client="))
      ?.split(";")[0] ?? "";
  const session = (await created.json()) as { id: string };
  const msg = await fetch(`${url}/agent/sessions/${session.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: clientCookie },
    body: JSON.stringify({ message: "hello", coreUrl: "https://core.example.com" }),
  });
  expect(msg.status).toBe(401);
  expect(await msg.json()).toMatchObject({ error: { code: "auth_required" } });
});
