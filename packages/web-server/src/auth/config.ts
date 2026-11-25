// Opt-in OIDC auth mode (issue #200). `DIKW_WEB_AUTH_MODE=oidc` turns the
// standalone server into a Backend-for-Frontend: users sign in through an
// external OpenID Connect provider, the dikw-core token stays server-side, agent
// sessions are scoped per user, and viewer/editor roles are enforced. Unset (the
// default) → `null` → the server behaves exactly as before.
//
// Same `.env.local` + precedence as the agent / web loaders. Missing or invalid
// values fail fast at startup (matching the DIKW_AGENT_* behavior); error
// messages name the variable, never its value.

import { join } from "node:path";
import { readEnvFile, readOptional } from "../shared/env.js";

export interface AuthConfig {
  /** Browser-facing origin, no trailing slash. Redirect URI = `{publicUrl}/web/auth/callback`. */
  publicUrl: string;
  /** Issuer exactly as configured (the ID token `iss` is matched against discovery). */
  issuer: string;
  /** Optional origin for server-to-server IdP calls (discovery, token, JWKS). */
  internalUrl?: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** Explicit provider opt-in (e.g. Google's offline access); protocol fields cannot be overridden. */
  authorizationParams?: Partial<Record<"access_type" | "prompt", string>>;
  /** Claim path the role names are read from, e.g. `roles`, `realm_access.roles`, `roles[].name`. */
  rolesClaim: string;
  /** Keep only role objects whose `owner` equals this (Casdoor organization). */
  rolesOwner?: string;
  viewerRoles: string[];
  editorRoles: string[];
  sessionSecret: string;
  sessionTtlSeconds: number;
  sessionMaxSeconds: number;
  sessionRefreshSeconds: number;
  coreUrl: string;
  serverToken: string;
  /** OIDC `sub` that inherits the pre-auth `"demo"` agent sessions (read-time merge). */
  legacySessionsOwner?: string;
}

export interface LoadAuthConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const REQUIRED = [
  "DIKW_WEB_PUBLIC_URL",
  "DIKW_WEB_OIDC_ISSUER",
  "DIKW_WEB_OIDC_CLIENT_ID",
  "DIKW_WEB_OIDC_CLIENT_SECRET",
  "DIKW_WEB_SESSION_SECRET",
  "DIKW_CORE_URL",
  "DIKW_SERVER_TOKEN",
] as const;

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SESSION_SECRET_LENGTH = 32;

export const DEFAULT_LISTEN_HOST = "127.0.0.1";

/** True only for explicit loopback bind addresses (127.0.0.0/8, ::1, localhost). */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  const unbracketed =
    normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  if (unbracketed === "localhost" || unbracketed === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(unbracketed);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  return parts[0] === 127 && parts.every((part) => part >= 0 && part <= 255);
}

/**
 * Vite dev middleware never mounts the OIDC BFF gate. Fail closed whenever
 * `server.host` resolves to a non-loopback address (`true` / `0.0.0.0` / LAN IP).
 */
export function assertLoopbackDevHost(host: string | boolean | undefined): void {
  if (host === undefined || host === false) return;
  if (host === true || !isLoopbackHost(host)) {
    throw new Error(
      "non-loopback Vite dev server host is forbidden without OIDC; bind Vite dev to a loopback host (e.g. 127.0.0.1) or use the standalone server with DIKW_WEB_AUTH_MODE=oidc",
    );
  }
}

export async function loadAuthConfig(
  options: LoadAuthConfigOptions = {},
): Promise<AuthConfig | null> {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = await readEnvFile(join(cwd, ".env.local"));
  const env = { ...fileEnv, ...(options.env ?? process.env) };

  const mode = env.DIKW_WEB_AUTH_MODE?.trim().toLowerCase() ?? "";
  if (mode === "" || mode === "off") {
    return null;
  }
  if (mode !== "oidc") {
    throw new Error('DIKW_WEB_AUTH_MODE must be "oidc" or "off"');
  }

  const missing = REQUIRED.filter((key) => !readOptional(env, key));
  if (missing.length > 0) {
    throw new Error(`auth mode "oidc" requires: ${missing.join(", ")}`);
  }
  const value = (key: (typeof REQUIRED)[number]) => readOptional(env, key)!;

  const viewerRoles = readList(env, "DIKW_WEB_ROLE_VIEWER");
  const editorRoles = readList(env, "DIKW_WEB_ROLE_EDITOR");
  if (viewerRoles.length === 0 && editorRoles.length === 0) {
    throw new Error("auth mode requires DIKW_WEB_ROLE_VIEWER and/or DIKW_WEB_ROLE_EDITOR");
  }

  const sessionSecret = value("DIKW_WEB_SESSION_SECRET");
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `DIKW_WEB_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`,
    );
  }

  const internalUrl = readOptional(env, "DIKW_WEB_OIDC_INTERNAL_URL");
  const rolesOwner = readOptional(env, "DIKW_WEB_OIDC_ROLES_OWNER");
  const legacySessionsOwner = readOptional(env, "DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER");
  const authorizationParams = readAuthorizationParams(env);
  const config: AuthConfig = {
    publicUrl: readOrigin(value("DIKW_WEB_PUBLIC_URL"), "DIKW_WEB_PUBLIC_URL"),
    issuer: readHttpUrl(value("DIKW_WEB_OIDC_ISSUER"), "DIKW_WEB_OIDC_ISSUER"),
    ...(internalUrl ? { internalUrl: readOrigin(internalUrl, "DIKW_WEB_OIDC_INTERNAL_URL") } : {}),
    clientId: value("DIKW_WEB_OIDC_CLIENT_ID"),
    clientSecret: value("DIKW_WEB_OIDC_CLIENT_SECRET"),
    scopes: readOptional(env, "DIKW_WEB_OIDC_SCOPES") ?? "openid profile email",
    ...(authorizationParams ? { authorizationParams } : {}),
    rolesClaim: readOptional(env, "DIKW_WEB_OIDC_ROLES_CLAIM") ?? "roles",
    ...(rolesOwner ? { rolesOwner } : {}),
    viewerRoles,
    editorRoles,
    sessionSecret,
    sessionTtlSeconds: readSeconds(
      env,
      "DIKW_WEB_SESSION_TTL_SECONDS",
      DEFAULT_SESSION_TTL_SECONDS,
    ),
    sessionMaxSeconds: readSeconds(env, "DIKW_WEB_SESSION_MAX_SECONDS", 7 * 24 * 60 * 60),
    sessionRefreshSeconds: readSeconds(env, "DIKW_WEB_SESSION_REFRESH_SECONDS", 15 * 60),
    coreUrl: readHttpUrl(value("DIKW_CORE_URL"), "DIKW_CORE_URL"),
    serverToken: value("DIKW_SERVER_TOKEN"),
    ...(legacySessionsOwner ? { legacySessionsOwner } : {}),
  };
  let coreUrlEnd = config.coreUrl.length;
  while (coreUrlEnd > 0 && config.coreUrl[coreUrlEnd - 1] === "/") {
    coreUrlEnd -= 1;
  }
  config.coreUrl = config.coreUrl.slice(0, coreUrlEnd);
  return config;
}

function readList(env: Record<string, string | undefined>, key: string): string[] {
  return (env[key] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readAuthorizationParams(
  env: Record<string, string | undefined>,
): AuthConfig["authorizationParams"] {
  const raw = readOptional(env, "DIKW_WEB_OIDC_AUTH_PARAMS");
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, item]) =>
          ["access_type", "prompt"].includes(key) && typeof item === "string" && item.trim(),
      )
    ) {
      return value as AuthConfig["authorizationParams"];
    }
  } catch {
    /* fall through without echoing the configured value */
  }
  throw new Error(
    "DIKW_WEB_OIDC_AUTH_PARAMS must be a JSON object with string access_type/prompt values only",
  );
}

/** `raw` unchanged when it is an absolute http(s) URL; throws otherwise. */
function readHttpUrl(raw: string, key: string): string {
  try {
    const { protocol } = new URL(raw);
    if (protocol === "http:" || protocol === "https:") {
      return raw;
    }
  } catch {
    // fall through
  }
  throw new Error(`${key} must be an absolute http(s) URL`);
}

/** An absolute http(s) URL with no path/query, returned as its bare origin. */
function readOrigin(raw: string, key: string): string {
  const url = new URL(readHttpUrl(raw, key));
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${key} must be an origin without a path (e.g. https://kb.example.com)`);
  }
  return url.origin;
}

function readSeconds(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = readOptional(env, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}
