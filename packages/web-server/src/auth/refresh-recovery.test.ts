// @vitest-environment node
import { expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAuthGate } from "./gate";
import { createOidcClient } from "./oidc";
import { AuthSessionStore } from "./sessionStore";
import type { AuthConfig } from "./config";
it("retains a rotated refresh grant through a temporary UserInfo outage without admitting stale claims", async () => {
  const now = 2_000_000,
    secret = "s".repeat(32),
    issuer = "http://fixture.invalid";
  const config = {
    publicUrl: "http://kb.invalid",
    issuer,
    clientId: "synthetic",
    clientSecret: "synthetic",
    scopes: "openid",
    sessionSecret: secret,
    sessionTtlSeconds: 28800,
    sessionMaxSeconds: 604800,
    sessionRefreshSeconds: 900,
    rolesClaim: "roles",
    viewerRoles: ["viewer"],
    editorRoles: ["editor"],
  } as AuthConfig;
  const granted: (string | null)[] = [];
  let userInfoCalls = 0;
  const oidc = createOidcClient(config, {
    fetch: async (url, options) => {
      const path = new URL(url as string).pathname;
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (path.includes("openid-configuration"))
        return json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          userinfo_endpoint: issuer + "/userinfo",
          jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      if (path === "/token") {
        const token = new URLSearchParams(options?.body as string).get("refresh_token");
        granted.push(token);
        if (token !== (granted.length === 1 ? "old-refresh" : "rotated-refresh"))
          return json({ error: "invalid_grant" }, 400);
        return json({
          access_token: "rotated-access",
          token_type: "Bearer",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      }
      if (path === "/userinfo")
        return userInfoCalls++ === 0
          ? json({ error: "temporarily_unavailable" }, 503)
          : json({ sub: "synthetic", roles: ["viewer"] });
      throw Error("unexpected synthetic path");
    },
  });
  const sessions = new AuthSessionStore({ path: ":memory:", secret, now: () => now });
  try {
    const id = sessions.create(
      {
        sub: "synthetic",
        role: "editor",
        idToken: "synthetic-id",
        accessToken: "old-access",
        authenticatedAt: 1000,
        renewal: { refreshToken: "old-refresh", startedAt: 1000000, refreshedAt: 1000000 },
      },
      3600,
    );
    const gate = createAuthGate({ config, oidc, sessions, now: () => now });
    async function request() {
      const res = {
        statusCode: 0,
        body: "",
        setHeader() {},
        end(v: string) {
          this.body = v;
        },
      };
      await gate.authorize(
        {
          url: "/web/auth/me",
          method: "GET",
          headers: { cookie: `dikw_session=${id}` },
        } as IncomingMessage,
        res as unknown as ServerResponse,
      );
      return res;
    }
    expect((await request()).statusCode).toBe(503);
    expect(sessions.get(id)?.renewal?.refreshToken).toBe("rotated-refresh");
    expect(sessions.get(id)?.accessToken).toBe("old-access");
    const recovered = await request();
    expect(recovered.statusCode).toBe(200);
    expect(JSON.parse(recovered.body).role).toBe("viewer");
    expect(granted).toEqual(["old-refresh", "rotated-refresh"]);
    expect(sessions.get(id)?.authenticatedAt).toBe(1000);
  } finally {
    sessions.close();
  }
});
