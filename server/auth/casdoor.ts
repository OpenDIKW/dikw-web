import { SessionValidationError, type SessionValidator } from "@opendikw/web-server/runtime";

/** Match the shared sidecar's existing literal KEY=value file contract. This
 * application adapter must not reinterpret # or escapes inside credentials. */
export function casdoorEnvironment(text: string, environment: Record<string, string | undefined>) {
  const file: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(),
      split = line.indexOf("=");
    if (!line || line.startsWith("#") || split < 0) continue;
    let value = line.slice(split + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    file[line.slice(0, split).trim()] = value;
  }
  return { ...file, ...environment };
}

/** Optional workbench policy; the shared runtime remains provider-independent. */
export function createCasdoorSessionValidator(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
): SessionValidator | undefined {
  const enabled = env.DIKW_WEB_CASDOOR_LIVE_AUTH?.trim();
  if (!enabled || enabled === "false") return undefined;
  if (enabled !== "true") throw new Error("DIKW_WEB_CASDOOR_LIVE_AUTH must be true or false");
  if (env.DIKW_WEB_AUTH_MODE?.trim().toLowerCase() !== "oidc")
    throw new Error("Casdoor live authorization requires DIKW_WEB_AUTH_MODE=oidc");
  // Casdoor can mask hidden fields as false/empty; shape checks cannot detect it.
  if (env.DIKW_WEB_IAM_STATUS_FIELDS_VERIFIED !== "true")
    throw new Error(
      "DIKW_WEB_IAM_STATUS_FIELDS_VERIFIED requires verified account field visibility",
    );
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Casdoor live authorization requires ${key}`);
    return value;
  };
  const issuer = required("DIKW_WEB_OIDC_ISSUER");
  const issuerOrigin = origin(issuer, "DIKW_WEB_OIDC_ISSUER");
  const base = env.DIKW_WEB_OIDC_INTERNAL_URL?.trim()
    ? origin(env.DIKW_WEB_OIDC_INTERNAL_URL.trim(), "DIKW_WEB_OIDC_INTERNAL_URL")
    : issuerOrigin;
  const clientId = required("DIKW_WEB_OIDC_CLIENT_ID");
  const secret = required("DIKW_WEB_OIDC_CLIENT_SECRET");
  const owner = required("DIKW_WEB_OIDC_ROLES_OWNER");
  const roles = (key: string) =>
    (env[key] ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  const editors = roles("DIKW_WEB_ROLE_EDITOR"),
    viewers = roles("DIKW_WEB_ROLE_VIEWER");
  if (!editors.length && !viewers.length)
    throw new Error("Casdoor live authorization requires mapped roles");

  return async (identity) => {
    try {
      if (
        identity.issuer !== issuer ||
        identity.clientId !== clientId ||
        !identity.sub ||
        !identity.accessToken ||
        !Number.isSafeInteger(identity.authenticatedAt) ||
        identity.authenticatedAt <= 0
      )
        throw new SessionValidationError(401);
      const signal = AbortSignal.timeout(8000);
      async function request(url: URL, options: RequestInit, userCredential = false) {
        const response = await fetcher(url, { ...options, redirect: "error", signal });
        // Client authentication errors are operator/provider failures, not proof
        // that this user's session was revoked.
        if (userCredential && (response.status === 401 || response.status === 403))
          throw new SessionValidationError(401);
        if (!response.ok) throw new SessionValidationError(503);
        const result: unknown = await response.json();
        if (!record(result)) throw new SessionValidationError(503);
        return result;
      }
      const token = await request(new URL("/api/login/oauth/introspect", base), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Casdoor supports the same client_secret_post authentication as our
        // OIDC client; older releases do not URL-decode Basic credentials.
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: secret,
          token: identity.accessToken,
          token_type_hint: "access_token",
        }),
      });
      if (typeof token.active !== "boolean") throw new SessionValidationError(503);
      if (!token.active) throw new SessionValidationError(401);
      const audience = typeof token.aud === "string" ? [token.aud] : token.aud;
      if (
        ![token.client_id, token.iss, token.sub].every((v) => typeof v === "string" && v.trim()) ||
        !Array.isArray(audience) ||
        !audience.length ||
        !audience.every((v) => typeof v === "string" && v.trim()) ||
        !Number.isSafeInteger(token.exp)
      )
        throw new SessionValidationError(503);
      if (
        token.client_id !== clientId ||
        token.iss !== issuer ||
        token.sub !== identity.sub ||
        !audience.includes(clientId) ||
        Number(token.exp) <= Date.now() / 1000
      )
        throw new SessionValidationError(401);

      const userUrl = new URL("/api/get-user", base);
      userUrl.search = new URLSearchParams({ owner, userId: identity.sub }).toString();
      const result = await request(
        userUrl,
        { headers: { Authorization: `Bearer ${identity.accessToken}` } },
        true,
      );
      const user = result.data;
      if (result.status !== "ok" || !record(user)) throw new SessionValidationError(503);
      if (
        typeof user.id !== "string" ||
        !user.id.trim() ||
        typeof user.owner !== "string" ||
        !user.owner.trim()
      )
        throw new SessionValidationError(503);
      if (user.id !== identity.sub || user.owner !== owner) throw new SessionValidationError(401);
      if (
        ![user.isForbidden, user.isDeleted, user.needUpdatePassword].every(
          (v) => typeof v === "boolean",
        ) ||
        typeof user.lastChangePasswordTime !== "string" ||
        !Array.isArray(user.roles) ||
        !user.roles.every(
          (r) =>
            record(r) &&
            typeof r.owner === "string" &&
            typeof r.name === "string" &&
            typeof r.isEnabled === "boolean",
        )
      )
        throw new SessionValidationError(503);
      if (user.isForbidden || user.isDeleted || user.needUpdatePassword)
        throw new SessionValidationError(403);
      if (user.lastChangePasswordTime) {
        const changedAt = Date.parse(user.lastChangePasswordTime);
        if (
          !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(user.lastChangePasswordTime) ||
          !Number.isFinite(changedAt)
        )
          throw new SessionValidationError(503);
        // Access-token iat changes on refresh. Only the original signed login
        // time supplied by the gate proves authentication after a password reset.
        if (changedAt >= identity.authenticatedAt * 1000) throw new SessionValidationError(401);
      }
      const names = user.roles
        .filter((r) => r.owner === owner && r.isEnabled === true)
        .map((r) => r.name);
      const role = names.some((r) => editors.includes(r))
        ? "editor"
        : names.some((r) => viewers.includes(r))
          ? "viewer"
          : null;
      if (!role) throw new SessionValidationError(403);
      return { role };
    } catch (error) {
      // Never expose request URLs, credentials or provider response/error text.
      throw error instanceof SessionValidationError ? error : new SessionValidationError(503);
    }
  };
}

function origin(value: string, key: string): string {
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      return url.origin;
  } catch {
    /* Report the key only; configuration may contain credentials. */
  }
  throw new Error(`${key} must be an HTTP(S) origin without credentials, path, query or fragment`);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
