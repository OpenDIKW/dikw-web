// Opt-in OIDC auth mode (issue #200), browser side. The SPA learns the mode at
// boot from `GET /web/auth/me` (`{ enabled: false }` when auth is off). In auth
// mode the server holds the core connection, so the clients go same-origin with
// no token; the server enforces roles and this only hides what a viewer can't do.

import { createContext, useContext } from "react";

export type AuthRole = "viewer" | "editor";

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}

export type AuthState = { enabled: false } | { enabled: true; user: AuthUser; role: AuthRole };

const AUTH_OFF: AuthState = { enabled: false };
const GUARDED_API = /^\/(v1|agent|web)\//;

export async function loadAuth(): Promise<AuthState> {
  let response: Response;
  try {
    response = await fetch("/web/auth/me", { headers: { Accept: "application/json" } });
  } catch {
    return AUTH_OFF;
  }
  if (response.status === 401) {
    // Auth mode, but the session ended between the page load and this probe.
    // Never resolve: the page is navigating to the IdP.
    redirectToLogin();
    return new Promise<AuthState>(() => {});
  }
  if (!response.ok) {
    return AUTH_OFF;
  }
  try {
    const body = (await response.json()) as Partial<{
      enabled: boolean;
      user: AuthUser;
      role: unknown;
    }>;
    if (body.enabled && body.user?.sub && (body.role === "viewer" || body.role === "editor")) {
      return { enabled: true, user: body.user, role: body.role };
    }
  } catch {
    // fall through
  }
  return AUTH_OFF;
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
