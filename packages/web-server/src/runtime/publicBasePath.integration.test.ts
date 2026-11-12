// @vitest-environment node
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWebRuntime } from "@opendikw/web-server/runtime";
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
  const cwd = await mkdtemp(join(tmpdir(), "dikw-public-path-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "dist"));
  await writeFile(
    join(cwd, "dist/index.html"),
    "<!doctype html><title>Mounted application</title>",
  );
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

async function application(publicBasePath?: string) {
  const idp = await startFakeIdp({ clientId: "mount-fixture", clientSecret: "fixture-client" });
  cleanups.push(() => idp.close());
  const cwd = await workspace();
  const prefix = publicBasePath === "/" ? "" : (publicBasePath ?? "");
  const url = await listen(
    createServer((req, res) => {
      // The application owns the mount and passes root-relative routes to the runtime.
      if (prefix && req.url?.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
      void runtime.handler(req, res);
    }),
  );
  const runtime = await createWebRuntime({
    appId: "dikw-mbweb",
    profile: "mbweb",
    cwd,
    publicBasePath,
    env: {
      NODE_ENV: "production",
      DIKW_WEB_CORE_ID: "mounted-fixture",
      DIKW_WEB_AUTH_MODE: "oidc",
      DIKW_WEB_PUBLIC_URL: url,
      DIKW_WEB_OIDC_ISSUER: idp.issuer,
      DIKW_WEB_OIDC_CLIENT_ID: "mount-fixture",
      DIKW_WEB_OIDC_CLIENT_SECRET: "fixture-client",
      DIKW_WEB_SESSION_SECRET: "m".repeat(32),
      DIKW_WEB_ROLE_VIEWER: "viewer",
      DIKW_WEB_ROLE_EDITOR: "editor",
      DIKW_CORE_URL: "http://127.0.0.1:9",
      DIKW_SERVER_TOKEN: "fixture-server-token",
      DIKW_AGENT_API_KEY: "fixture-only",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
      DIKW_AGENT_MODEL: "fixture",
    },
  });
  cleanups.push(() => runtime.close());
  const send = (path: string, init?: RequestInit) =>
    fetch(`${url}${prefix}${path}`, { redirect: "manual", ...init });
  async function login(sub: string, role = "editor") {
    const response = await send(
      `/web/auth/login?returnTo=${encodeURIComponent(`${prefix}/#papers`)}`,
      {
        headers: {
          "x-forwarded-prefix": "/untrusted",
          "x-forwarded-host": "other.example",
          "x-forwarded-proto": "https",
        },
      },
    );
    const authorization = new URL(response.headers.get("location")!);
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `${url}${prefix}/web/auth/callback`,
    );
    const approved = idp.approve(authorization.href, { sub, roles: [role] });
    const callback = await send(
      `/web/auth/callback?code=${approved.code}&state=${encodeURIComponent(approved.state)}`,
      { headers: { cookie: cookie(response, "dikw_mbweb_login") } },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${prefix}/#papers`);
    return cookie(callback, "dikw_mbweb_session");
  }
  return { idp, url, prefix, send, login, runtime };
}

it("uses a nested public OIDC base path while keeping internal routes, roles and Origin checks", async () => {
  const app = await application("/team/knowledge-base/research");
  const alice = await app.login("alice");
  expect(
    await (await app.send("/web/auth/me", { headers: { cookie: alice } })).json(),
  ).toMatchObject({
    user: { sub: "alice" },
    role: "editor",
  });
  const create = () =>
    app.send("/agent/sessions", {
      method: "POST",
      headers: { cookie: alice, origin: app.url },
    });
  const created = await create();
  expect(created.status).toBe(201);
  const session = (await created.json()) as { id: string };
  expect(
    (
      await app.send("/agent/sessions", {
        method: "POST",
        headers: { cookie: alice, origin: `${app.url}${app.prefix}` },
      })
    ).status,
  ).toBe(403);
  expect((await app.send("/agent/sessions")).status).toBe(401);
  const bob = await app.login("bob", "viewer");
  expect(
    (await app.send(`/agent/sessions/${session.id}`, { headers: { cookie: bob } })).status,
  ).toBe(404);
  expect(
    (
      await app.send("/v1/ingest", {
        method: "POST",
        headers: { cookie: bob, origin: app.url },
      })
    ).status,
  ).toBe(403);
  const logout = await app.send("/web/auth/logout", {
    method: "POST",
    headers: { cookie: alice, origin: app.url },
  });
  expect(logout.status).toBe(303);
  expect(
    new URL(logout.headers.get("location")!).searchParams.get("post_logout_redirect_uri"),
  ).toBe(`${app.url}${app.prefix}/`);
  expect((await app.send("/web/auth/me", { headers: { cookie: alice } })).status).toBe(401);
  await app.runtime.close();
  await app.runtime.close();
  expect((await app.send("/agent/sessions", { headers: { cookie: bob } })).status).toBe(503);
});

it.each([undefined, "", "/"])(
  "retains root OIDC behavior for publicBasePath=%s",
  async (basePath) => {
    const app = await application(basePath);
    const session = await app.login("root-user");
    expect((await app.send("/web/auth/me", { headers: { cookie: session } })).status).toBe(200);
  },
);

it("rejects invalid state, nonce and signed identity at a public OIDC base path", async () => {
  const app = await application("/knowledge-base");
  for (const failure of ["state", "nonce", "signature"]) {
    const response = await app.send("/web/auth/login");
    const authorization = response.headers.get("location")!;
    const approved = app.idp.approve(
      authorization,
      { sub: "alice", roles: ["editor"], ...(failure === "nonce" ? { nonce: "wrong" } : {}) },
      { forge: failure === "signature" },
    );
    const callback = await app.send(
      `/web/auth/callback?code=${approved.code}&state=${failure === "state" ? "wrong" : encodeURIComponent(approved.state)}`,
      { headers: { cookie: cookie(response, "dikw_mbweb_login") } },
    );
    expect(callback.status).toBe(400);
    expect(cookie(callback, "dikw_mbweb_session")).toBe("");
    expect((await app.send("/web/auth/me")).status).toBe(401);
  }
});

it.each([
  "knowledge-base",
  "/knowledge-base/",
  "/knowledge-base?query=1",
  "/knowledge-base#section",
  "//other.example",
  "https://other.example/knowledge-base",
  "/knowledge-base//research",
  "/knowledge-base/../other",
  "/knowledge-base/./research",
  "/knowledge-base%2Fresearch",
  "/knowledge-base\\research",
  "/Knowledge-Base",
  "/knowledge-base ",
])(
  "rejects a noncanonical public base path %s before initializing resources",
  async (publicBasePath) => {
    const cwd = await workspace();
    await expect(
      createWebRuntime({
        appId: "dikw-web",
        profile: "workbench",
        cwd,
        publicBasePath,
        env: { DIKW_WEB_AUTH_MODE: "off" },
      }),
    ).rejects.toThrow("publicBasePath must be a canonical absolute path");
  },
);
