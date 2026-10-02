// @vitest-environment node
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "./config";
import { startFakeIdp } from "./fakeIdp";
import { createAuthGate, safeReturnTo } from "./gate";
import { createOidcClient } from "./oidc";
import { AuthSessionStore } from "./sessionStore";

const PUBLIC_URL = "https://kb.example.com";
const CLIENT_SECRET = "oidc-client-secret-value";
const CORE_TOKEN = "core-bearer-token-value";

describe("safeReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/#chat", "/#chat"],
    ["/base?path=a%2Fb#x", "/base?path=a%2Fb#x"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(safeReturnTo(input, PUBLIC_URL)).toBe(expected);
  });

  it.each([
    "//evil.example.com/",
    "/\\evil.example.com",
    // Dot segments that normalize to a protocol-relative "//host" path.
    "/.//evil.example.com",
    "/%2e//evil.example.com",
    "/x/..//evil.example.com",
    "https://evil.example.com/",
    "javascript:alert(1)",
    "chat",
    "",
    null,
  ])("rejects %s", (input) => {
    expect(safeReturnTo(input, PUBLIC_URL)).toBeNull();
  });
});

describe("auth gate", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  async function setup(
    overrides: Partial<AuthConfig> = {},
    idpOptions: { endSession?: boolean } = {},
  ) {
    const idp = await startFakeIdp({
      clientId: "dikw-web",
      clientSecret: CLIENT_SECRET,
      ...idpOptions,
    });
    cleanups.push(() => idp.close());
    let now = Date.now();
    const config: AuthConfig = {
      publicUrl: PUBLIC_URL,
      issuer: idp.issuer,
      clientId: "dikw-web",
      clientSecret: CLIENT_SECRET,
      scopes: "openid profile email",
      rolesClaim: "roles",
      viewerRoles: ["kb_viewer"],
      editorRoles: ["kb_editor"],
      sessionSecret: "q".repeat(32),
      sessionTtlSeconds: 3600,
      coreUrl: "http://core.internal:8765",
      serverToken: CORE_TOKEN,
      ...overrides,
    };
    const sessions = new AuthSessionStore({
      path: ":memory:",
      secret: config.sessionSecret,
      now: () => now,
    });
    cleanups.push(() => sessions.close());
    const gate = createAuthGate({ config, oidc: createOidcClient(config), sessions });
    const server = createServer((req, res) => {
      void gate.authorize(req, res).then((principal) => {
        if (!principal) return;
        // Stand-in for the app handlers: echo who the gate let through.
        expect(gate.principalOf(req)).toEqual(principal);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ through: true, principal }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;

    const seen: string[] = [];
    async function send(
      path: string,
      init: { method?: string; cookie?: string; origin?: string; accept?: string } = {},
    ) {
      const headers: Record<string, string> = { Accept: init.accept ?? "application/json" };
      if (init.cookie) headers.Cookie = init.cookie;
      if (init.origin) headers.Origin = init.origin;
      const response = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        redirect: "manual",
      });
      const body = await response.text();
      seen.push(JSON.stringify([...response.headers.entries()]), body);
      return { response, body };
    }

    async function signIn(claims: Record<string, unknown>, returnTo = "/%23chat") {
      const login = await send(`/web/auth/login?returnTo=${returnTo}`, { accept: "text/html" });
      const txCookie = cookieFrom(login.response, "dikw_login");
      const { code, state } = idp.approve(login.response.headers.get("location")!, claims);
      const callback = await send(
        `/web/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
        { cookie: txCookie, accept: "text/html" },
      );
      return { login, callback, cookie: cookieFrom(callback.response, "dikw_session") };
    }

    return {
      idp,
      send,
      signIn,
      seen,
      advance: (ms: number) => (now += ms),
    };
  }

  function cookieFrom(response: Response, name: string): string {
    const header = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
    return header ? header.split(";")[0] : "";
  }

  it("sends an unauthenticated page load to login, keeping the hash route to come back to", async () => {
    const { send } = await setup();
    const { response, body } = await send("/base?x=1", { accept: "text/html" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(response.headers.get("cache-control")).toBe("no-store");

    // The hash (#chat, #MB-Web) never reaches the server, so a tiny script
    // builds the return path in the browser...
    const script = /<script>([^<]*)<\/script>/.exec(body)![1];
    const replace = vi.fn();
    new Function("location", script)({ pathname: "/", search: "?x=1", hash: "#MB-Web", replace });
    expect(replace).toHaveBeenCalledWith("/web/auth/login?returnTo=%2F%3Fx%3D1%23MB-Web");
    // ...which the page's CSP allows by hash (else the browser would block it)...
    const digest = createHash("sha256").update(script).digest("base64");
    expect(response.headers.get("content-security-policy")).toContain(`'sha256-${digest}'`);
    // ...with a no-script fallback that still keeps the path + query.
    expect(body).toContain('content="0;url=/web/auth/login?returnTo=%2Fbase%3Fx%3D1"');
  });

  it.each(["/v1/base/pages", "/agent/sessions", "/web/translate/health", "/assets/app.js"])(
    "answers an unauthenticated API call to %s with 401",
    async (path) => {
      const { send } = await setup();
      const { response, body } = await send(path);
      expect(response.status).toBe(401);
      expect(JSON.parse(body)).toEqual({
        error: { code: "unauthenticated", message: expect.any(String) },
      });
    },
  );

  it("signs a user in through the IdP and lands back on the requested page", async () => {
    const { send, signIn } = await setup();
    const { login, callback, cookie } = await signIn({
      name: "Ada",
      email: "ada@example.com",
      roles: ["kb_editor"],
    });

    expect(login.response.status).toBe(302);
    const txHeader = login.response.headers.getSetCookie()[0];
    expect(txHeader).toMatch(/^dikw_login=/);
    expect(txHeader).toMatch(/HttpOnly/);
    expect(txHeader).toMatch(/SameSite=Lax/);
    expect(txHeader).toMatch(/Secure/);

    expect(callback.response.status).toBe(302);
    expect(callback.response.headers.get("location")).toBe("/#chat");
    const sessionHeader = callback.response.headers
      .getSetCookie()
      .find((c) => c.startsWith("dikw_session="))!;
    expect(sessionHeader).toMatch(/HttpOnly/);
    expect(sessionHeader).toMatch(/SameSite=Lax/);
    expect(sessionHeader).toMatch(/Secure/);
    expect(sessionHeader).toMatch(/Path=\//);
    expect(sessionHeader).toMatch(/Max-Age=3600/);

    const me = await send("/web/auth/me", { cookie });
    expect(JSON.parse(me.body)).toEqual({
      enabled: true,
      user: { sub: "user-1", name: "Ada", email: "ada@example.com" },
      role: "editor",
    });

    const through = await send("/v1/base/pages", { cookie });
    expect(JSON.parse(through.body)).toMatchObject({
      through: true,
      principal: { sub: "user-1", role: "editor" },
    });
  });

  it("lands on / when the requested return path is off-origin", async () => {
    const { signIn } = await setup();
    const { callback } = await signIn(
      { roles: ["kb_viewer"] },
      encodeURIComponent("//evil.example.com"),
    );
    expect(callback.response.headers.get("location")).toBe("/");
  });

  it("refuses a callback without the login transaction cookie (no redirect loop)", async () => {
    const { send } = await setup();
    const { response } = await send("/web/auth/callback?code=x&state=y", { accept: "text/html" });
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie().some((c) => c.startsWith("dikw_session="))).toBe(false);
  });

  it("refuses a callback whose ID token fails validation", async () => {
    const { send, idp } = await setup();
    const login = await send("/web/auth/login", { accept: "text/html" });
    const { code, state } = idp.approve(login.response.headers.get("location")!, {
      nonce: "replayed",
    });
    const { response } = await send(`/web/auth/callback?code=${code}&state=${state}`, {
      cookie: cookieFrom(login.response, "dikw_login"),
      accept: "text/html",
    });
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie().some((c) => c.startsWith("dikw_session="))).toBe(false);
  });

  it("gives a signed-in user without a mapped role a 403 page they can sign out from", async () => {
    const { send, signIn } = await setup();
    const { cookie } = await signIn({ roles: ["staff"] });

    const page = await send("/", { cookie, accept: "text/html" });
    expect(page.response.status).toBe(403);
    expect(page.response.headers.get("content-type")).toMatch(/text\/html/);
    expect(page.body).toContain('action="/web/auth/logout"');
    // Browsers apply form-action to the logout's 303 to the IdP's end-session
    // endpoint (usually another origin), so the policy must not pin forms to 'self'.
    const csp = page.response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("form-action");

    const api = await send("/v1/base/pages", { cookie });
    expect(api.response.status).toBe(403);
    expect(JSON.parse(api.body).error.code).toBe("no_role");

    const me = await send("/web/auth/me", { cookie });
    expect(JSON.parse(me.body)).toMatchObject({ enabled: true, role: null });
  });

  it("reads Casdoor-style role objects through the configured claim path + owner", async () => {
    const { send, signIn } = await setup({ rolesClaim: "roles[].name", rolesOwner: "my-org" });
    const { cookie } = await signIn({
      roles: [
        { owner: "other-org", name: "kb_editor" },
        { owner: "my-org", name: "kb_viewer", isEnabled: true },
      ],
    });
    const me = await send("/web/auth/me", { cookie });
    expect(JSON.parse(me.body).role).toBe("viewer");
  });

  it("requires an exact Origin on state-changing requests", async () => {
    const { send, signIn } = await setup();
    const { cookie } = await signIn({ roles: ["kb_editor"] });

    for (const origin of [undefined, "https://evil.example.com", "https://kb.example.com:8443"]) {
      const { response, body } = await send("/v1/ingest", { method: "POST", cookie, origin });
      expect(response.status).toBe(403);
      expect(JSON.parse(body).error.code).toBe("csrf_origin_mismatch");
    }
    const ok = await send("/v1/ingest", { method: "POST", cookie, origin: PUBLIC_URL });
    expect(JSON.parse(ok.body).through).toBe(true);
  });

  it("enforces the viewer/editor matrix server-side", async () => {
    const { send, signIn } = await setup();
    const viewer = (await signIn({ roles: ["kb_viewer"] })).cookie;
    const editor = (await signIn({ roles: ["kb_editor"] })).cookie;
    const editorOnly: Array<[string, string]> = [
      ["POST", "/v1/import"],
      ["POST", "/v1/ingest"],
      ["POST", "/v1/synth"],
      ["POST", "/v1/lint/apply"],
      ["POST", "/v1/tasks/t-1/cancel"],
      ["POST", "/v1/base/wisdom"],
      ["POST", "/web/mineru/convert"],
      ["POST", "/agent/sessions/s-1/proposals/p-1/confirm"],
    ];
    for (const [method, path] of editorOnly) {
      const denied = await send(path, { method, cookie: viewer, origin: PUBLIC_URL });
      expect(denied.response.status, `${method} ${path}`).toBe(403);
      expect(JSON.parse(denied.body).error.code).toBe("forbidden");
      const allowed = await send(path, { method, cookie: editor, origin: PUBLIC_URL });
      expect(JSON.parse(allowed.body).through, `${method} ${path}`).toBe(true);
    }
    for (const [method, path] of [
      ["GET", "/v1/base/graph"],
      ["POST", "/v1/retrieve"],
      ["POST", "/agent/sessions/s-1/messages"],
      ["POST", "/web/translate/submit"],
    ]) {
      const allowed = await send(path, { method, cookie: viewer, origin: PUBLIC_URL });
      expect(JSON.parse(allowed.body).through, `${method} ${path}`).toBe(true);
    }
  });

  it("signs out: drops the session and hands off to the IdP end_session_endpoint", async () => {
    const { send, signIn, idp } = await setup();
    const { cookie } = await signIn({ roles: ["kb_viewer"] });

    const forged = await send("/web/auth/logout", { method: "POST", cookie });
    expect(forged.response.status).toBe(403);
    expect((await send("/web/auth/me", { cookie })).response.status).toBe(200);

    const { response } = await send("/web/auth/logout", {
      method: "POST",
      cookie,
      origin: PUBLIC_URL,
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${idp.issuer}/logout`);
    expect(location.searchParams.get("id_token_hint")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(response.headers.getSetCookie().find((c) => c.startsWith("dikw_session="))).toMatch(
      /Max-Age=0/,
    );
    expect((await send("/web/auth/me", { cookie })).response.status).toBe(401);
  });

  it("signs out locally when the IdP has no end_session_endpoint", async () => {
    const { send, signIn } = await setup({}, { endSession: false });
    const { cookie } = await signIn({ roles: ["kb_viewer"] });
    const { response } = await send("/web/auth/logout", {
      method: "POST",
      cookie,
      origin: PUBLIC_URL,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });

  it("expires the session after the configured TTL and rejects a tampered cookie", async () => {
    const { send, signIn, advance } = await setup();
    const { cookie } = await signIn({ roles: ["kb_viewer"] });
    expect((await send("/web/auth/me", { cookie: `${cookie}x` })).response.status).toBe(401);
    advance(3600 * 1000);
    expect((await send("/web/auth/me", { cookie })).response.status).toBe(401);
  });

  it("never sends the OIDC client secret or the core token to the browser", async () => {
    const { send, signIn, seen } = await setup();
    const { cookie } = await signIn({ roles: ["kb_editor"] });
    await send("/web/auth/me", { cookie });
    await send("/", { cookie: "", accept: "text/html" });
    await send("/web/auth/logout", { method: "POST", cookie, origin: PUBLIC_URL });
    const everything = seen.join("\n");
    expect(everything).not.toContain(CLIENT_SECRET);
    expect(everything).not.toContain(CORE_TOKEN);
  });
});
