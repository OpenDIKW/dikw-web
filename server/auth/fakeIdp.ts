// Test support only (not imported by the server): a minimal in-process OpenID
// Provider for the auth tests. Serves discovery + JWKS + a token endpoint that
// enforces client_secret_post, redirect_uri and PKCE S256, and signs RS256 ID
// tokens with node:crypto so the tests need no extra dependency.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface FakeIdpOptions {
  clientId: string;
  clientSecret: string;
  /** Issuer advertised in discovery + ID tokens. Defaults to the server's own URL. */
  issuer?: string;
  /** Advertise an end_session_endpoint (RP-initiated logout). Default true. */
  endSession?: boolean;
}

interface PendingCode {
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
  forge: boolean;
}

export interface FakeIdp {
  /** Base URL the server actually listens on. */
  url: string;
  issuer: string;
  /**
   * Simulate the user approving the authorization request at `authorizeUrl`.
   * `claims` override the ID token's; `forge` signs it with a key the JWKS
   * never publishes (same `kid`).
   */
  approve(
    authorizeUrl: string,
    claims?: Record<string, unknown>,
    options?: { forge?: boolean },
  ): { code: string; state: string };
  /** Paths the IdP received (to assert which host served back-channel calls). */
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeIdp(options: FakeIdpOptions): Promise<FakeIdp> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forgeryKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, PendingCode>();
  const requests: string[] = [];
  let issuer = options.issuer ?? "";

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(url.pathname);
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        ...(options.endSession === false ? {} : { end_session_endpoint: `${issuer}/logout` }),
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") {
      return send(200, { keys: [jwk] });
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const code = form.get("code") ?? "";
      const pending = codes.get(code);
      codes.delete(code);
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (
        !pending ||
        form.get("grant_type") !== "authorization_code" ||
        form.get("client_id") !== options.clientId ||
        form.get("client_secret") !== options.clientSecret ||
        form.get("redirect_uri") !== pending.redirectUri ||
        challenge !== pending.codeChallenge
      ) {
        return send(400, { error: "invalid_grant" });
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer,
        aud: options.clientId,
        sub: "user-1",
        iat: now,
        exp: now + 300,
        nonce: pending.nonce,
        ...pending.claims,
      };
      return send(200, {
        access_token: randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 300,
        id_token: signJwt(claims, pending.forge ? forgeryKey : privateKey),
      });
    }
    send(404, { error: "not_found" });
  });

  function signJwt(claims: Record<string, unknown>, key: KeyObject): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode(claims)}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake IdP did not bind");
  const url = `http://127.0.0.1:${address.port}`;
  issuer ||= url;

  return {
    url,
    issuer,
    requests,
    approve(authorizeUrl, claims = {}, { forge = false } = {}) {
      const params = new URL(authorizeUrl).searchParams;
      if (params.get("code_challenge_method") !== "S256") {
        throw new Error("fake IdP: PKCE S256 required");
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        nonce: params.get("nonce") ?? "",
        codeChallenge: params.get("code_challenge") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        claims,
        forge,
      });
      return { code, state: params.get("state") ?? "" };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
