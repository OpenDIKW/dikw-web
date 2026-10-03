// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { startFakeIdp, type FakeIdp, type FakeIdpOptions } from "./fakeIdp";
import { createOidcClient, type OidcClient } from "./oidc";
import type { AuthConfig } from "./config";

const CLIENT_ID = "dikw-web";
const CLIENT_SECRET = "client-secret-value";
const PUBLIC_URL = "https://kb.example.com";

describe("createOidcClient", () => {
  const idps: FakeIdp[] = [];
  afterEach(async () => {
    while (idps.length) await idps.pop()!.close();
  });

  async function setup(
    options: Partial<FakeIdpOptions> & {
      internal?: boolean;
      fetch?: typeof fetch;
      authorizationParams?: AuthConfig["authorizationParams"];
    } = {},
  ) {
    const idp = await startFakeIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      endSession: options.endSession,
      refreshTokens: options.refreshTokens,
      rotateRefreshTokens: options.rotateRefreshTokens,
      revocation: options.revocation,
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
        ...(options.authorizationParams
          ? { authorizationParams: options.authorizationParams }
          : {}),
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

  it("requests provider offline access only when explicitly configured", async () => {
    const { oidc } = await setup({
      authorizationParams: { access_type: "offline", prompt: "consent" },
    });
    const { url, tx } = await oidc.beginLogin("/");
    const params = new URL(url).searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("scope")).toBe("openid profile email");
    expect(params.get("nonce")).toBe(tx.nonce);
  });

  it("renews tokens through the internal URL and returns changed roles and the rotated token", async () => {
    const { idp, oidc } = await setup({
      internal: true,
      refreshTokens: true,
      rotateRefreshTokens: true,
    });
    const signedIn = await login(idp, oidc, { roles: ["kb_editor"] });
    expect(signedIn.refreshToken).toBe(idp.refreshTokens[0]);
    idp.refresh.claims = { roles: ["kb_viewer"] };
    const renewed = await oidc.refresh(signedIn.refreshToken!, "user-1");
    expect(renewed.claims).toMatchObject({ sub: "user-1", roles: ["kb_viewer"] });
    expect(renewed.refreshToken).toBe(idp.refreshTokens[1]);
    expect(renewed.idToken?.split(".")).toHaveLength(3);
    await expect(oidc.refresh(signedIn.refreshToken!, "user-1")).rejects.toThrow();
  });

  it.each([
    ["a changed subject", { sub: "another-user" }, false],
    ["a foreign issuer", { iss: "https://evil.example.com" }, false],
    ["a foreign audience", { aud: "someone-else" }, false],
    ["a foreign authorized party", { azp: "someone-else" }, false],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 3600 }, false],
    ["a forged signature", {}, true],
  ])("rejects refreshed ID tokens with %s", async (_label, claims, forge) => {
    const { idp, oidc } = await setup({ refreshTokens: true });
    const signedIn = await login(idp, oidc);
    idp.refresh.claims = claims;
    idp.refresh.forge = forge;
    await expect(oidc.refresh(signedIn.refreshToken!, "user-1")).rejects.toThrow();
  });

  it("uses subject-checked UserInfo when refresh returns no ID token", async () => {
    const { idp, oidc } = await setup({ internal: true, refreshTokens: true });
    const signedIn = await login(idp, oidc, { roles: ["kb_editor"] });
    idp.refresh.idToken = false;
    idp.refresh.claims = { roles: ["kb_viewer"] };
    const renewed = await oidc.refresh(signedIn.refreshToken!, "user-1");
    expect(renewed.claims).toMatchObject({ sub: "user-1", roles: ["kb_viewer"] });
    expect(renewed.idToken).toBeUndefined();
    expect(idp.requests).toContain("/userinfo");
    idp.refresh.claims = { sub: "another-user" };
    await expect(oidc.refresh(renewed.refreshToken!, "user-1")).rejects.toThrow();
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

  it("revokes refresh tokens through the advertised internal endpoint", async () => {
    const { idp, oidc } = await setup({ internal: true, refreshTokens: true, revocation: true });
    const signedIn = await login(idp, oidc);
    await oidc.revoke(signedIn.refreshToken!);
    expect(idp.revokedTokens).toEqual([signedIn.refreshToken]);
    await expect(oidc.refresh(signedIn.refreshToken!, "user-1")).rejects.toThrow();
  });

  it("skips token revocation when the provider advertises no endpoint", async () => {
    const { idp, oidc } = await setup();
    await expect(oidc.revoke("refresh-value")).resolves.toBeUndefined();
    expect(idp.requests).not.toContain("/revoke");
  });
});
