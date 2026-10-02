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
  /** Claim path the role names are read from, e.g. `roles`, `realm_access.roles`, `roles[].name`. */
  rolesClaim: string;
  /** Keep only role objects whose `owner` equals this (Casdoor organization). */
  rolesOwner?: string;
  viewerRoles: string[];
  editorRoles: string[];
  sessionSecret: string;
  sessionTtlSeconds: number;
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
  return {
    publicUrl: readOrigin(value("DIKW_WEB_PUBLIC_URL"), "DIKW_WEB_PUBLIC_URL"),
    issuer: readHttpUrl(value("DIKW_WEB_OIDC_ISSUER"), "DIKW_WEB_OIDC_ISSUER").raw,
    ...(internalUrl ? { internalUrl: readOrigin(internalUrl, "DIKW_WEB_OIDC_INTERNAL_URL") } : {}),
    clientId: value("DIKW_WEB_OIDC_CLIENT_ID"),
    clientSecret: value("DIKW_WEB_OIDC_CLIENT_SECRET"),
    scopes: readOptional(env, "DIKW_WEB_OIDC_SCOPES") ?? "openid profile email",
    rolesClaim: readOptional(env, "DIKW_WEB_OIDC_ROLES_CLAIM") ?? "roles",
    ...(rolesOwner ? { rolesOwner } : {}),
    viewerRoles,
    editorRoles,
    sessionSecret,
    sessionTtlSeconds: readTtl(env),
    coreUrl: readHttpUrl(value("DIKW_CORE_URL"), "DIKW_CORE_URL").raw.replace(/\/+$/, ""),
    serverToken: value("DIKW_SERVER_TOKEN"),
    ...(legacySessionsOwner ? { legacySessionsOwner } : {}),
  };
}

function readList(env: Record<string, string | undefined>, key: string): string[] {
  return (env[key] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readHttpUrl(raw: string, key: string): { raw: string; url: URL } {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { raw, url };
    }
  } catch {
    // fall through
  }
  throw new Error(`${key} must be an absolute http(s) URL`);
}

/** An absolute http(s) URL with no path/query, returned as its bare origin. */
function readOrigin(raw: string, key: string): string {
  const { url } = readHttpUrl(raw, key);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${key} must be an origin without a path (e.g. https://kb.example.com)`);
  }
  return url.origin;
}

function readTtl(env: Record<string, string | undefined>): number {
  const raw = readOptional(env, "DIKW_WEB_SESSION_TTL_SECONDS");
  if (raw === undefined) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("DIKW_WEB_SESSION_TTL_SECONDS must be a positive integer");
  }
  return value;
}
