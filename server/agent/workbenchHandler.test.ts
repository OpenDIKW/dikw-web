// @vitest-environment node
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWebRuntime } from "@opendikw/web-server/runtime";
import { createWorkbenchHandler } from "./workbenchHandler.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function authenticatedServer() {
  const cwd = await mkdtemp(join(tmpdir(), "dikw-workbench-shell-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const staticDir = join(cwd, "build");
  await mkdir(join(staticDir, "assets"), { recursive: true });
  await writeFile(
    join(staticDir, "index.html"),
    '<!doctype html><h1>Local backup entry</h1><script src="/assets/app.js"></script>',
  );
  await writeFile(join(staticDir, "assets/app.js"), "export const backup = true;");
  await writeFile(join(staticDir, "config.json"), '{"mbWebUrl":"https://papers.example.com"}');
  await writeFile(join(staticDir, "private.json"), '{"internal":"not public"}');
  const runtime = await createWebRuntime({
    appId: "dikw-web",
    profile: "workbench",
    cwd,
    staticDir,
    env: {
      DIKW_WEB_AUTH_MODE: "oidc",
      DIKW_WEB_PUBLIC_URL: "http://127.0.0.1:4321",
      DIKW_WEB_OIDC_ISSUER: "http://127.0.0.1:9",
      DIKW_WEB_OIDC_CLIENT_ID: "fixture",
      DIKW_WEB_OIDC_CLIENT_SECRET: "fixture-only",
      DIKW_WEB_ROLE_VIEWER: "viewer",
      DIKW_WEB_ROLE_EDITOR: "editor",
      DIKW_WEB_SESSION_SECRET: "s".repeat(32),
      DIKW_CORE_URL: "http://127.0.0.1:9",
      DIKW_SERVER_TOKEN: "fixture-only",
      DIKW_AGENT_API_KEY: "fixture-only",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
      DIKW_AGENT_MODEL: "fixture",
    },
  });
  cleanups.push(() => runtime.close());
  const handler = createWorkbenchHandler(runtime, staticDir);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, cwd, staticDir };
}

it("serves the built backup shell and assets without contacting an unavailable IdP", async () => {
  const { url } = await authenticatedServer();
  const page = await fetch(url + "/", { headers: { accept: "text/html" } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Local backup entry");
  const asset = await fetch(url + "/assets/app.js");
  expect(asset.status).toBe(200);
  expect(await asset.text()).toBe("export const backup = true;");
  expect(asset.headers.get("content-type")).toContain("javascript");
  const config = await fetch(url + "/config.json");
  expect(config.status).toBe(200);
  expect(await config.json()).toEqual({ mbWebUrl: "https://papers.example.com" });
});

it("keeps APIs, static writes and files outside the public shell behind the real auth gate", async () => {
  const { url } = await authenticatedServer();
  for (const path of [
    "/web/auth/me",
    "/v1/base/pages",
    "/agent/sessions",
    "/web/jobs/fixture",
    "/private.json",
  ]) {
    expect((await fetch(url + path)).status, path).toBe(401);
  }
  for (const path of ["/", "/assets/app.js", "/v1/base/wisdom"]) {
    expect((await fetch(url + path, { method: "POST" })).status, path).toBe(401);
  }
});

it("rejects filesystem links and encoded traversal instead of exposing private static bytes", async () => {
  const { url, cwd, staticDir } = await authenticatedServer();
  const privateDir = join(cwd, "private-fixture");
  await mkdir(privateDir);
  await writeFile(join(privateDir, "private.js"), "private fixture bytes");
  await symlink(privateDir, join(staticDir, "assets/neutral"), "junction");
  const linked = await fetch(url + "/assets/neutral/private.js");
  expect(linked.status).toBe(403);
  expect(await linked.text()).not.toContain("private fixture bytes");
  const traversal = await fetch(url + "/assets/%2e%2e%2fprivate.json");
  expect(traversal.status).toBe(401);
  expect(await traversal.text()).not.toContain("not public");
});

it("reports missing public assets as missing files without an authentication challenge", async () => {
  const { url } = await authenticatedServer();
  const asset = await fetch(url + "/assets/missing.js");
  expect(asset.status).toBe(404);
  expect(await asset.text()).not.toContain("sign in");
});
