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
  const session = (await created[0].json()) as { id: string };
  expect(session.id).toBeTruthy();
  await runtime.close();
  await runtime.close();
  expect(await readdir(join(cwd, "mb-sessions"))).toContain("agent.sqlite");
  expect((await fetch(`${url}/agent/sessions`)).status).toBe(503);
  runtime = await createWebRuntime(options);
  const sessions = (await (await fetch(`${url}/agent/sessions`)).json()) as Array<{ id: string }>;
  expect(sessions.map((item) => item.id)).toContain(session.id);
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
