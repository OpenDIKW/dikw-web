// @vitest-environment node
import { createServer, type Server } from "node:http";
import { createCipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createWebRuntime } from "@opendikw/web-server/runtime";
import { createCasdoorSessionValidator } from "./casdoor";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "workbench-casdoor-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const staticDir = join(cwd, "dist");
  await mkdir(staticDir);
  await writeFile(join(staticDir, "index.html"), "synthetic fixture");
  const state = {
    available: true,
    active: true,
    role: "editor",
    changed: "",
    forbidden: false,
    calls: 0,
    refreshes: 0,
  };
  const issuer = await listen(
    createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      const path = new URL(req.url!, issuer).pathname;
      if (path === "/.well-known/openid-configuration")
        return res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: issuer + "/authorize",
            token_endpoint: issuer + "/token",
            userinfo_endpoint: issuer + "/userinfo",
            jwks_uri: issuer + "/jwks",
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        );
      if (path === "/token") {
        state.refreshes++;
        return res.end(
          JSON.stringify({
            access_token: "fixture-rotated-access-secret",
            refresh_token: "fixture-rotated-refresh-secret",
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
      }
      if (path === "/userinfo") return res.end(JSON.stringify({ sub: "alice", roles: ["editor"] }));
      state.calls++;
      if (!state.available) {
        res.statusCode = 503;
        return res.end('{"error":"temporary"}');
      }
      if (path === "/api/login/oauth/introspect")
        return res.end(
          JSON.stringify({
            active: state.active,
            client_id: "workbench",
            iss: issuer,
            aud: ["workbench"],
            sub: "alice",
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
          }),
        );
      if (path === "/api/get-user")
        return res.end(
          JSON.stringify({
            status: "ok",
            data: {
              id: "alice",
              owner: "fixture",
              isForbidden: state.forbidden,
              isDeleted: false,
              needUpdatePassword: false,
              lastChangePasswordTime: state.changed,
              roles: state.role ? [{ owner: "fixture", name: state.role, isEnabled: true }] : [],
            },
          }),
        );
      res.statusCode = 404;
      res.end("{}");
    }),
  );
  const env = {
    DIKW_WEB_AUTH_MODE: "oidc",
    DIKW_WEB_CASDOOR_LIVE_AUTH: "true",
    DIKW_WEB_IAM_STATUS_FIELDS_VERIFIED: "true",
    DIKW_WEB_PUBLIC_URL: "http://127.0.0.1:4321",
    DIKW_WEB_OIDC_ISSUER: issuer,
    DIKW_WEB_OIDC_CLIENT_ID: "workbench",
    DIKW_WEB_OIDC_CLIENT_SECRET: "fixture-client-secret",
    DIKW_WEB_OIDC_ROLES_OWNER: "fixture",
    DIKW_WEB_ROLE_EDITOR: "editor",
    DIKW_WEB_ROLE_VIEWER: "viewer",
    DIKW_WEB_SESSION_SECRET: "synthetic-session-key-".repeat(3),
    DIKW_CORE_URL: "http://127.0.0.1:9",
    DIKW_SERVER_TOKEN: "fixture-core-secret",
    DIKW_AGENT_API_KEY: "fixture-disabled-key",
    DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
    DIKW_AGENT_MODEL: "disabled",
  };
  const runtime = await createWebRuntime({
    appId: "dikw-web",
    profile: "workbench",
    cwd,
    staticDir,
    env,
    validateSession: createCasdoorSessionValidator(env),
  });
  cleanup.push(() => runtime.close());
  const url = await listen(
    createServer((req, res) => {
      void runtime.handler(req, res);
    }),
  );
  // A synthetic persisted-session fixture exercises the actual public runtime
  // and sealed on-disk format without importing private shared-package modules.
  const id = randomBytes(32).toString("base64url");
  const loginIat = Math.floor(Date.now() / 1000) - 3600;
  const record = {
    sub: "alice",
    role: "editor",
    idToken: "fixture-id-secret",
    accessToken: "fixture-access-secret",
    authenticatedAt: loginIat,
  };
  function seed(data: Record<string, unknown> = record) {
    const iv = randomBytes(12),
      key = Buffer.from(
        hkdfSync("sha256", env.DIKW_WEB_SESSION_SECRET, "dikw-web-auth", "session-record", 32),
      );
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
    const db = new DatabaseSync(join(cwd, ".agent-sessions", "auth.sqlite"));
    db.prepare("INSERT OR REPLACE INTO auth_sessions (id_hash,data,expires_at) VALUES (?,?,?)").run(
      createHash("sha256").update(id).digest("hex"),
      sealed,
      Date.now() + 3600000,
    );
    db.close();
  }
  seed();
  async function request() {
    return fetch(url + "/web/auth/me", { headers: { Cookie: `dikw_session=${id}` } });
  }
  return { state, request, seed, record, loginIat };
}

it("updates the current role on the next request and terminates removed authorization", async () => {
  const f = await fixture();
  expect((await (await f.request()).json()).role).toBe("editor");
  f.state.role = "viewer";
  expect((await (await f.request()).json()).role).toBe("viewer");
  f.state.role = "";
  expect((await f.request()).status).toBe(403);
  f.state.role = "editor";
  expect((await f.request()).status).toBe(401);
});
it("returns temporary 503 without deleting the persisted session", async () => {
  const f = await fixture();
  f.state.available = false;
  const failed = await f.request();
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("secret");
  f.state.available = true;
  expect((await f.request()).status).toBe(200);
});
it("does not let a real refresh response wash away the original authentication time", async () => {
  const f = await fixture();
  f.seed({
    ...f.record,
    renewal: {
      refreshToken: "fixture-refresh-secret",
      startedAt: f.loginIat * 1000,
      refreshedAt: f.loginIat * 1000,
    },
  });
  f.state.changed = new Date((f.loginIat + 10) * 1000).toISOString();
  expect((await f.request()).status).toBe(401);
  expect(f.state.refreshes).toBe(1);
  f.state.changed = "";
  expect((await f.request()).status).toBe(401);
});
it("requires one new login for legacy records that lack original identity metadata", async () => {
  const f = await fixture();
  f.seed({ sub: "alice", role: "editor", idToken: "legacy-fixture-id" });
  expect((await f.request()).status).toBe(401);
  expect(f.state.calls).toBe(0);
});
it("terminates a revoked token before any application data is returned", async () => {
  const f = await fixture();
  f.state.active = false;
  expect((await f.request()).status).toBe(401);
  f.state.active = true;
  expect((await f.request()).status).toBe(401);
});
