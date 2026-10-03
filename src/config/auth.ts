// Opt-in OIDC auth mode (issue #200), browser side. The SPA learns the mode at
// boot from `GET /web/auth/me` (`{ enabled: false }` when auth is off). In auth
// mode the server holds the core connection, so the clients go same-origin with
// no token; the server enforces roles and this only hides what a viewer can't do.

import { createContext, useContext } from "react";

import type { AuthState, AuthUser } from "@opendikw/web-client/types";
export type { AuthRole, AuthUser, AuthState } from "@opendikw/web-client/types";

const AUTH_OFF: AuthState = { enabled: false };
const GUARDED_API = /^\/(v1|agent|web)\//;
// Cap the boot probe like the branding fetch, so a stalled server can't leave
// the page blank.
const AUTH_PROBE_TIMEOUT_MS = 5000;

/**
 * The boot probe couldn't tell whether auth is on: unreachable, timed out, a
 * server error, or an auth-mode answer without a usable role. The app must not
 * start as auth-off then, which would re-enable the browser-held core connection
 * (a stored token would go straight to core).
 */
export class AuthProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthProbeError";
  }
}

export async function loadAuth(): Promise<AuthState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS);
  try {
    return await probeAuth(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function probeAuth(signal: AbortSignal): Promise<AuthState> {
  let response: Response;
  let text: string;
  try {
    response = await fetch("/web/auth/me", { headers: { Accept: "application/json" }, signal });
    text = await response.text();
  } catch {
    throw new AuthProbeError("the server could not be reached");
  }
  if (response.status === 401) {
    // Auth mode, but the session ended between the page load and this probe.
    // Never resolve: the page is navigating to the IdP.
    redirectToLogin();
    return new Promise<AuthState>(() => {});
  }
  // An auth-mode server always answers this route with JSON, so a 404 or an
  // HTML page (a static host's SPA fallback) means a server without auth mode.
  if (response.status === 404) {
    return AUTH_OFF;
  }
  if (!response.ok) {
    throw new AuthProbeError(`sign-in status check failed (${response.status})`);
  }
  let body: Partial<{ enabled: unknown; user: AuthUser; role: unknown }> | null;
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return AUTH_OFF;
  }
  if (body?.enabled !== true) {
    return AUTH_OFF;
  }
  if (body.user?.sub && (body.role === "viewer" || body.role === "editor")) {
    return { enabled: true, user: body.user, role: body.role };
  }
  throw new AuthProbeError("unusable sign-in status");
}

let redirecting = false;

function redirectToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  const { pathname, search, hash } = window.location;
  window.location.assign(
    `/web/auth/login?returnTo=${encodeURIComponent(`${pathname}${search}${hash}`)}`,
  );
}

/**
 * Auth mode: a 401 from the same-origin `/v1`, `/agent` or `/web` APIs means the
 * session ended — send the user to sign in again and bring them back here. One
 * wrapper around `fetch` covers every client (DikwClient, AgentClient, the
 * translate / mineru helpers) without threading a callback through each.
 */
export function installUnauthorizedRedirect(): void {
  const next = window.fetch;
  window.fetch = async (input, init) => {
    const response = await next(input, init);
    if (response.status === 401 && isGuardedApi(input)) {
      redirectToLogin();
    }
    return response;
  };
}

function isGuardedApi(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  return url.origin === window.location.origin && GUARDED_API.test(url.pathname);
}

export const AuthContext = createContext<AuthState>(AUTH_OFF);

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Auth off → everything; auth mode → editors only. */
export function useCanEdit(): boolean {
  const auth = useAuth();
  return !auth.enabled || auth.role === "editor";
}
