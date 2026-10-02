// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { startFakeIdp, type FakeIdp } from "./fakeIdp";
import { createOidcClient, type OidcClient } from "./oidc";

const CLIENT_ID = "dikw-web";
const CLIENT_SECRET = "client-secret-value";
const PUBLIC_URL = "https://kb.example.com";

describe("createOidcClient", () => {
  const idps: FakeIdp[] = [];
  afterEach(async () => {
    while (idps.length) await idps.pop()!.close();
  });

  async function setup(
    options: { internal?: boolean; endSession?: boolean; fetch?: typeof fetch } = {},
  ) {
    const idp = await startFakeIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      endSession: options.endSession,
      // Behind an internal URL the IdP advertises its *public* issuer, which this
      // test process can't resolve — every back-channel call must be rewritten.
      ...(options.internal ? { issuer: "https://iam.example.test" } : {}),
    });
    idps.push(idp);
    const oidc = createOidcClient(
      {
        publicUrl: PUBLIC_URL,
        issuer: idp.issuer,
        ...(options.internal ? { internalUrl: idp.url } : {}),
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        scopes: "openid profile email",
      },
      options.fetch ? { fetch: options.fetch } : {},
    );
    return { idp, oidc };
  }

  async function login(
    idp: FakeIdp,
    oidc: OidcClient,
    claims: Record<string, unknown> = {},
    opts: { forge?: boolean; state?: string } = {},
  ) {
    const { url, tx } = await oidc.beginLogin("/#chat");
    const { code, state } = idp.approve(url, claims, opts);
    const callback = new URL(`${PUBLIC_URL}/web/auth/callback`);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", opts.state ?? state);
    return oidc.completeLogin(callback, tx);
  }

  it("builds a PKCE S256 authorization request without leaking the client secret", async () => {
    const { idp, oidc } = await setup();
    const { url, tx } = await oidc.beginLogin("/#chat");
    const authorize = new URL(url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${idp.issuer}/authorize`);
    const params = authorize.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(`${PUBLIC_URL}/web/auth/callback`);
    expect(params.get("scope")).toBe("openid profile email");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(tx.state);
    expect(params.get("nonce")).toBe(tx.nonce);
    expect(params.get("code_challenge")).not.toBe(tx.codeVerifier);
    expect(tx.returnTo).toBe("/#chat");
    expect(url).not.toContain(CLIENT_SECRET);
  });

  it("exchanges the code and returns verified ID token claims", async () => {
    const { idp, oidc } = await setup();
    const result = await login(idp, oidc, { name: "Ada", roles: ["kb_editor"] });
    expect(result.claims).toMatchObject({ sub: "user-1", name: "Ada", roles: ["kb_editor"] });
    expect(result.idToken.split(".")).toHaveLength(3);
  });

  it.each([
    ["a state mismatch", {}, { state: "forged-state" }],
    ["a nonce mismatch", { nonce: "replayed" }, {}],
    ["a foreign issuer", { iss: "https://evil.example.com" }, {}],
    ["a foreign audience", { aud: "someone-else" }, {}],
    ["a foreign authorized party", { azp: "someone-else" }, {}],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 3600 }, {}],
    ["a signature from a key outside the JWKS", {}, { forge: true }],
  ])("rejects %s", async (_label, claims, opts) => {
    const { idp, oidc } = await setup();
    await expect(login(idp, oidc, claims, opts)).rejects.toThrow();
  });

  it("routes discovery, token and JWKS calls through the internal URL", async () => {
    const { idp, oidc } = await setup({ internal: true });
    const { url } = await oidc.beginLogin("/");
    // The browser is still sent to the public issuer.
    expect(url.startsWith("https://iam.example.test/authorize?")).toBe(true);
    const result = await login(idp, oidc);
    expect(result.claims.iss).toBe("https://iam.example.test");
    expect(idp.requests).toEqual(
      expect.arrayContaining(["/.well-known/openid-configuration", "/token", "/jwks"]),
    );
  });

  it("retries discovery after a failure instead of caching the error", async () => {
    let failNext = true;
    const flakyFetch: typeof fetch = (input, init) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new TypeError("fetch failed"));
      }
      return fetch(input, init);
    };
    const { oidc } = await setup({ fetch: flakyFetch });
    await expect(oidc.beginLogin("/")).rejects.toThrow();
    await expect(oidc.beginLogin("/")).resolves.toHaveProperty("url");
  });

  it("builds an RP-initiated logout URL when the IdP advertises end_session_endpoint", async () => {
    const { idp, oidc } = await setup();
    const logout = new URL((await oidc.logoutUrl("id.token.value"))!);
    expect(`${logout.origin}${logout.pathname}`).toBe(`${idp.issuer}/logout`);
    expect(logout.searchParams.get("id_token_hint")).toBe("id.token.value");
    expect(logout.searchParams.get("post_logout_redirect_uri")).toBe(`${PUBLIC_URL}/`);
  });

  it("returns null for logout when the IdP has no end_session_endpoint", async () => {
    const { oidc } = await setup({ endSession: false });
    expect(await oidc.logoutUrl("id.token.value")).toBeNull();
  });
});
