// Thin wrapper over openid-client (panva) for the auth-mode login flow:
// Authorization Code + PKCE (S256) with state + nonce, confidential client
// (client_secret_post — the secret never reaches the browser).
//
// openid-client validates the authorization response `state`, and the ID token
// `iss` (exactly the discovered issuer), `aud`, `exp`, `nonce`, and `azp` for
// multi-audience tokens. On top of that we:
//   - verify the ID token signature against the IdP's JWKS
//     (`enableNonRepudiationChecks`; JWKS is cached and refetched on an unknown
//     `kid`) — the back channel may be plain HTTP on a private network, so TLS
//     alone isn't a trust anchor;
//   - reject any `azp` that isn't our client id, even for a single-audience token.

import * as client from "openid-client";
import type { AuthConfig } from "./config.js";

export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Same-origin path to land on after login (validated by the caller). */
  returnTo: string;
}

export interface OidcClient {
  beginLogin(returnTo: string): Promise<{ url: string; tx: LoginTransaction }>;
  /** `callbackUrl` must be the *public* callback URL (it becomes the token request's redirect_uri). */
  completeLogin(
    callbackUrl: URL,
    tx: LoginTransaction,
  ): Promise<{ claims: Record<string, unknown>; idToken: string; refreshToken?: string }>;
  refresh(
    refreshToken: string,
    sub: string,
  ): Promise<{
    claims: Record<string, unknown>;
    idToken?: string;
    refreshToken?: string;
  }>;
  /** Best-effort logout caller; no request when the provider has no revocation endpoint. */
  revoke(refreshToken: string): Promise<void>;
  /** RP-initiated logout URL, or `null` when the IdP advertises no end_session_endpoint. */
  logoutUrl(idToken: string): Promise<string | null>;
}

type OidcSettings = Pick<
  AuthConfig,
  | "publicUrl"
  | "issuer"
  | "internalUrl"
  | "clientId"
  | "clientSecret"
  | "scopes"
  | "authorizationParams"
>;

export const CALLBACK_PATH = "/web/auth/callback";

export function createOidcClient(
  settings: OidcSettings,
  options: { fetch?: typeof fetch } = {},
): OidcClient {
  const fetchImpl = options.fetch ?? fetch;
  const issuerOrigin = new URL(settings.issuer).origin;
  const redirectUri = `${settings.publicUrl}${CALLBACK_PATH}`;

  // Server-to-server calls (discovery, token, JWKS) to the issuer's public
  // origin go to the internal URL instead; browser-facing URLs (authorize,
  // end_session) are untouched.
  const backChannelFetch: client.CustomFetch = (url, options) => {
    // CustomFetchOptions is a RequestInit subset; only its Uint8Array body type
    // is spelled more loosely than lib.dom's BodyInit.
    const init = options as RequestInit;
    const target = new URL(url);
    if (settings.internalUrl && target.origin === issuerOrigin) {
      return fetchImpl(new URL(`${target.pathname}${target.search}`, settings.internalUrl), init);
    }
    return fetchImpl(url, init);
  };

  let configuration: Promise<client.Configuration> | null = null;
  const getConfiguration = (): Promise<client.Configuration> => {
    configuration ??= client
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        settings.clientSecret,
        client.ClientSecretPost(settings.clientSecret),
        {
          [client.customFetch]: backChannelFetch,
          // Only an http:// *issuer* (local / test IdPs) needs this; an internal
          // http:// back channel is reached via the rewrite above.
          ...(issuerOrigin.startsWith("http:") ? { execute: [client.allowInsecureRequests] } : {}),
        },
      )
      .then((config) => {
        client.enableNonRepudiationChecks(config);
        return config;
      })
      .catch((error: unknown) => {
        // Don't pin a transient IdP outage: the next login retries discovery.
        configuration = null;
        throw error;
      });
    return configuration;
  };

  return {
    async beginLogin(returnTo) {
      const config = await getConfiguration();
      const tx: LoginTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
        returnTo,
      };
      const url = client.buildAuthorizationUrl(config, {
        ...settings.authorizationParams,
        redirect_uri: redirectUri,
        scope: settings.scopes,
        code_challenge: await client.calculatePKCECodeChallenge(tx.codeVerifier),
        code_challenge_method: "S256",
        state: tx.state,
        nonce: tx.nonce,
      });
      return { url: url.href, tx };
    },

    async completeLogin(callbackUrl, tx) {
      const config = await getConfiguration();
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: tx.codeVerifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || !tokens.id_token) {
        throw new Error("token response carried no ID token");
      }
      if (claims.azp !== undefined && claims.azp !== settings.clientId) {
        throw new Error('unexpected ID token "azp" (authorized party) claim value');
      }
      return {
        claims: { ...claims },
        idToken: tokens.id_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      };
    },

    async refresh(refreshToken, sub) {
      const config = await getConfiguration();
      const tokens = await client.refreshTokenGrant(config, refreshToken);
      const claims =
        tokens.claims() ?? (await client.fetchUserInfo(config, tokens.access_token, sub));
      if (claims.sub !== sub || (claims.azp !== undefined && claims.azp !== settings.clientId)) {
        throw new Error("unexpected refreshed identity");
      }
      return {
        claims: { ...claims },
        ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      };
    },

    async revoke(refreshToken) {
      const config = await getConfiguration();
      if (config.serverMetadata().revocation_endpoint) {
        await client.tokenRevocation(config, refreshToken, { token_type_hint: "refresh_token" });
      }
    },

    async logoutUrl(idToken) {
      const config = await getConfiguration();
      if (!config.serverMetadata().end_session_endpoint) {
        return null;
      }
      return client.buildEndSessionUrl(config, {
        id_token_hint: idToken,
        post_logout_redirect_uri: `${settings.publicUrl}/`,
      }).href;
    },
  };
}
