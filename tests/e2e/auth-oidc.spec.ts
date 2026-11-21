import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { createWebRuntime, type WebRuntime } from "@opendikw/web-server/runtime";
import { startFakeIdp, type FakeIdp } from "../../packages/web-server/src/auth/fakeIdp";
import {
  healthFixture,
  infoFixture,
  statusFixture,
  taskRowsFixture,
  wikiPagesFixture,
} from "./fixtures";
import { expect, test } from "./harness";

// Real-browser E2E for standalone OIDC BFF mode (`DIKW_WEB_AUTH_MODE=oidc`).
// Boots the real compiled `dist/` frontend behind `createWebRuntime` + an
// in-process RS256 OIDC IdP (`fakeIdp.ts`) + a mock dikw-core HTTP server that
// verifies server-side Bearer token injection. Covers what mocked dev E2E
// cannot: CSP login redirect preserving `#hash`, real PKCE/cookie session
// establishment, viewer vs editor UI + server 403 enforcement, CSRF Origin
// validation, Sign out, and 401 -> login re-authentication.

const SERVER_CORE_TOKEN = "e2e-server-only-core-secret-token";
const CLIENT_SECRET = "e2e-oidc-client-secret";
const SESSION_SECRET = "s".repeat(48);

interface OidcE2eHarness {
  baseUrl: string;
  idp: FakeIdp;
  coreRequests: Array<{ method: string; path: string; auth: string | undefined }>;
  setNextClaims(fn: () => Record<string, unknown>): void;
  close(): Promise<void>;
}

function latestMtimeMs(dir: string): number {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, latestMtimeMs(full));
    } else if (entry.isFile()) {
      max = Math.max(max, statSync(full).mtimeMs);
    }
  }
  return max;
}

/**
 * Reuse `dist/` when it already exists and is newer than frontend sources (e.g.
 * right after `npm run build` in `npm run verify`); otherwise build a fresh bundle
 * into a temporary directory so standalone `npm run test:e2e` works on a clean
 * checkout and never silently tests a stale `dist/`.
 */
function resolveFreshStaticDir(): { staticDir: string; cleanup?: () => void } {
  const distDir = resolve("dist");
  const distIndex = join(distDir, "index.html");
  if (existsSync(distIndex)) {
    const builtAt = statSync(distIndex).mtimeMs;
    const latestSrc = Math.max(
      latestMtimeMs(resolve("src")),
      latestMtimeMs(resolve("packages/web-client/src")),
      latestMtimeMs(resolve("packages/web-ui/src")),
      statSync(resolve("index.html")).mtimeMs,
      statSync(resolve("package.json")).mtimeMs,
    );
    if (builtAt >= latestSrc) {
      return { staticDir: distDir };
    }
  }
  const tempDist = mkdtempSync(join(tmpdir(), "dikw-e2e-oidc-dist-"));
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      tempDist,
      "--logLevel",
      "error",
    ],
    { stdio: "inherit" },
  );
  return {
    staticDir: tempDist,
    cleanup: () => rmSync(tempDist, { recursive: true, force: true }),
  };
}

async function startOidcHarness(): Promise<OidcE2eHarness> {
  const { staticDir, cleanup: cleanupStaticDir } = resolveFreshStaticDir();

  const sessionsDir = mkdtempSync(join(tmpdir(), "dikw-e2e-oidc-"));
  const coreRequests: OidcE2eHarness["coreRequests"] = [];
  let nextClaims: () => Record<string, unknown> = () => ({ sub: "default", roles: ["kb_viewer"] });

  const coreServer: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    coreRequests.push({
      method: req.method ?? "GET",
      path: url.pathname,
      auth: req.headers.authorization,
    });
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/v1/health") return send(200, healthFixture);
    if (url.pathname === "/v1/status") return send(200, statusFixture);
    if (url.pathname === "/v1/info") return send(200, infoFixture);
    if (url.pathname === "/v1/base/pages") return send(200, wikiPagesFixture);
    if (url.pathname === "/v1/tasks") {
      return send(200, { tasks: taskRowsFixture, next_cursor: null, has_more: false });
    }
    return send(200, {});
  });
  await new Promise<void>((r) => coreServer.listen(0, "127.0.0.1", r));
  const coreAddr = coreServer.address();
  if (!coreAddr || typeof coreAddr === "string") throw new Error("mock core did not bind");
  const coreUrl = `http://127.0.0.1:${coreAddr.port}`;

  // endSession: false routes Sign out to the BFF's own `/web/auth/signed-out` page.
  const idp = await startFakeIdp({
    clientId: "dikw-e2e",
    clientSecret: CLIENT_SECRET,
    endSession: false,
    onAuthorize: () => nextClaims(),
  });

  // Bind the BFF port first so DIKW_WEB_PUBLIC_URL matches the real origin.
  const runtimeRef: { current?: WebRuntime } = {};
  const appServer: Server = createServer((req, res) => {
    if (!runtimeRef.current) {
      res.statusCode = 503;
      res.end("starting");
      return;
    }
    void runtimeRef.current.handler(req, res);
  });
  await new Promise<void>((r) => appServer.listen(0, "127.0.0.1", r));
  const appAddr = appServer.address();
  if (!appAddr || typeof appAddr === "string") throw new Error("app server did not bind");
  const baseUrl = `http://127.0.0.1:${appAddr.port}`;

  runtimeRef.current = await createWebRuntime({
    appId: "dikw-web",
    profile: "workbench",
    // Isolate from any developer `.env.local` in the repository root.
    cwd: sessionsDir,
    staticDir,
    env: {
      DIKW_WEB_AUTH_MODE: "oidc",
      DIKW_WEB_PUBLIC_URL: baseUrl,
      DIKW_WEB_OIDC_ISSUER: idp.issuer,
      DIKW_WEB_OIDC_CLIENT_ID: "dikw-e2e",
      DIKW_WEB_OIDC_CLIENT_SECRET: CLIENT_SECRET,
      DIKW_WEB_ROLE_VIEWER: "kb_viewer",
      DIKW_WEB_ROLE_EDITOR: "kb_editor",
      DIKW_WEB_SESSION_SECRET: SESSION_SECRET,
      DIKW_CORE_URL: coreUrl,
      DIKW_SERVER_TOKEN: SERVER_CORE_TOKEN,
      DIKW_AGENT_API_KEY: "e2e-unused-agent-key",
      DIKW_AGENT_BASE_URL: "http://127.0.0.1:1",
      DIKW_AGENT_MODEL: "e2e-unused-model",
      DIKW_AGENT_SESSIONS_DIR: sessionsDir,
    },
  });

  return {
    baseUrl,
    idp,
    coreRequests,
    setNextClaims(fn) {
      nextClaims = fn;
    },
    async close() {
      await new Promise<void>((r) => appServer.close(() => r()));
      await runtimeRef.current?.close();
      await idp.close();
      await new Promise<void>((r) => coreServer.close(() => r()));
      rmSync(sessionsDir, { recursive: true, force: true });
      cleanupStaticDir?.();
    },
  };
}

async function silenceExternalFonts(page: Page) {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  await page.route("https://fonts.gstatic.com/**", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
}

test.describe("OIDC BFF auth mode", () => {
  // These tests share one in-process IdP/BFF harness with per-test claim overrides.
  test.describe.configure({ mode: "serial" });

  let harness: OidcE2eHarness;

  test.beforeAll(async () => {
    harness = await startOidcHarness();
  });

  test.afterAll(async () => {
    await harness?.close();
  });

  test("preserves hash route across login, keeps core token server-side, and signs out", async ({
    page,
  }) => {
    await silenceExternalFonts(page);
    harness.setNextClaims(() => ({
      sub: "editor-1",
      name: "Ada Editor",
      email: "ada@example.com",
      roles: ["kb_editor"],
    }));

    // Unauthenticated navigation to #settings should round-trip through OIDC and return to #settings.
    await page.goto(`${harness.baseUrl}/#settings`);
    await expect(page).toHaveURL(`${harness.baseUrl}/#settings`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(main.getByText("Ada Editor")).toBeVisible();
    await expect(main.getByText("ada@example.com")).toBeVisible();
    await expect(main.getByText("Editor", { exact: true })).toBeVisible();

    // Connection Server URL / Token form must not render in auth mode; Import is visible for editors.
    await expect(page.getByRole("heading", { name: "Connection" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import" })).toBeVisible();

    // Navigate to Overview to exercise the BFF `/v1` proxy and confirm token stays server-side.
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(harness.coreRequests.length).toBeGreaterThan(0);
    for (const req of harness.coreRequests) {
      expect(req.auth).toBe(`Bearer ${SERVER_CORE_TOKEN}`);
    }

    // Core server token must never leak to browser storage, cookies, or rendered DOM.
    const leaked = await page.evaluate((secret) => {
      return (
        document.body.innerText.includes(secret) ||
        document.cookie.includes(secret) ||
        JSON.stringify(localStorage).includes(secret)
      );
    }, SERVER_CORE_TOKEN);
    expect(leaked).toBe(false);

    // Same-origin GET /web/auth/me returns the active principal.
    const meStatus = await page.evaluate(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/web/auth/me`);
      return res.status;
    }, harness.baseUrl);
    expect(meStatus).toBe(200);

    // Cross-origin CSRF check against the real BFF HTTP server with the active cookie.
    const cookies = await page.context().cookies(harness.baseUrl);
    const sessionCookie = cookies.find((c) => c.name === "dikw_session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    const csrfRes = await fetch(`${harness.baseUrl}/web/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: `dikw_session=${sessionCookie!.value}`,
        Origin: "https://evil.example",
      },
      redirect: "manual",
    });
    expect(csrfRes.status).toBe(403);

    // Real form POST Sign out clears the session and lands on `/web/auth/signed-out`.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${harness.baseUrl}/web/auth/signed-out`);

    const afterLogout = await fetch(`${harness.baseUrl}/web/auth/me`, {
      headers: { Cookie: `dikw_session=${sessionCookie!.value}` },
    });
    expect(afterLogout.status).toBe(401);
  });

  test("enforces viewer role in both UI and server endpoints, and redirects on 401", async ({
    page,
    context,
  }) => {
    let loginCount = 0;
    await silenceExternalFonts(page);
    harness.setNextClaims(() => {
      loginCount += 1;
      return {
        sub: "viewer-1",
        name: "Victor Viewer",
        email: "victor@example.com",
        roles: ["kb_viewer"],
      };
    });

    await page.goto(`${harness.baseUrl}/#overview`);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(loginCount).toBe(1);

    // Viewer cannot see the editor-only Import navigation item.
    await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);

    // Viewer role is shown in Settings.
    await page.getByRole("button", { name: "Settings" }).click();
    const main = page.getByRole("main");
    await expect(main.getByText("Victor Viewer")).toBeVisible();
    await expect(main.getByText("Viewer", { exact: true })).toBeVisible();

    // Server independently enforces 403 on editor-only write endpoints even if called directly.
    const [importStatus, mineruStatus] = await page.evaluate(async () => {
      const imp = await fetch("/v1/import", { method: "POST" });
      const mineru = await fetch("/web/mineru/jobs", { method: "POST" });
      return [imp.status, mineru.status];
    });
    expect(importStatus).toBe(403);
    expect(mineruStatus).toBe(403);

    // Clearing the session cookie simulates session expiry; next same-origin `/v1` call
    // triggers `installUnauthorizedRedirect()` -> automatic re-login.
    await context.clearCookies();
    await page.getByRole("button", { name: "Overview" }).click();
    await expect.poll(() => loginCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});
