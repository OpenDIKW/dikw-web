// The auth-mode gate (issue #200): owns /web/auth/* and decides, for every other
// request, whether it may reach the app handlers. The server is the source of
// truth — the SPA only hides what a role can't do.
//
//   no session        → page load: a page that sends the browser to login (keeping
//                       the #hash route to return to) / API: 401
//   no mapped role    → 403 (an HTML page with Sign out, or JSON)
//   unsafe method     → Origin must equal DIKW_WEB_PUBLIC_URL exactly (CSRF;
//                       SameSite=Lax alone doesn't cover same-site other ports)
//   requiredRole()    → 403 when the caller's role is below it

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthConfig } from "./config.js";
import { CALLBACK_PATH, type LoginTransaction, type OidcClient } from "./oidc.js";
import { extractRoles, requiredRole, resolveRole, type AuthRole } from "./roles.js";
import { createSealer } from "./seal.js";
import type { AuthSession, AuthSessionStore } from "./sessionStore.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("auth");

const SESSION_COOKIE = "dikw_session";
const LOGIN_COOKIE = "dikw_login";
/** The gate's own routes; also the login cookie's Path. */
const AUTH_PATH = "/web/auth";
const LOGIN_TTL_SECONDS = 600;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface Principal {
  sub: string;
  name?: string;
  email?: string;
  role: AuthRole;
}

export interface AuthGateOptions {
  config: AuthConfig;
  oidc: OidcClient;
  sessions: AuthSessionStore;
}

export interface AuthGate {
  /**
   * Returns the caller when the request may proceed to the app handlers.
   * Otherwise the gate has already responded (a /web/auth/* route, a login
   * redirect, a 401 or a 403) and returns `null`.
   */
  authorize(req: IncomingMessage, res: ServerResponse): Promise<Principal | null>;
  /** The principal `authorize` admitted for this request. */
  principalOf(req: IncomingMessage): Principal | undefined;
}

/** A same-origin absolute path to return to after login, or `null`. */
export function safeReturnTo(value: string | null, publicUrl: string): string | null {
  if (!value?.startsWith("/")) {
    return null;
  }
  try {
    const url = new URL(value, publicUrl);
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Judge the *normalized* path: dot segments turn "/.//host" into "//host",
    // which a browser follows as a protocol-relative (off-site) redirect.
    return url.origin === publicUrl && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export function createAuthGate({ config, oidc, sessions }: AuthGateOptions): AuthGate {
  const principals = new WeakMap<IncomingMessage, Principal>();
  const loginSealer = createSealer(config.sessionSecret, "login-transaction");
  const secure = config.publicUrl.startsWith("https:");

  function cookie(name: string, value: string, maxAge: number, path = "/"): string {
    return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  function currentSession(req: IncomingMessage): { id: string; session: AuthSession } | null {
    const id = readCookie(req, SESSION_COOKIE);
    const session = id ? sessions.get(id) : null;
    return id && session ? { id, session } : null;
  }

  function originAllowed(req: IncomingMessage): boolean {
    return SAFE_METHODS.has(req.method ?? "GET") || req.headers.origin === config.publicUrl;
  }

  async function login(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"), config.publicUrl) ?? "/";
    let begun: Awaited<ReturnType<OidcClient["beginLogin"]>>;
    try {
      begun = await oidc.beginLogin(returnTo);
    } catch (error) {
      log.error("identity provider unavailable", { error });
      return sendPage(req, res, 502, "idpUnavailable");
    }
    const sealed = loginSealer.seal({ ...begun.tx, exp: Date.now() + LOGIN_TTL_SECONDS * 1000 });
    res.setHeader("Set-Cookie", cookie(LOGIN_COOKIE, sealed, LOGIN_TTL_SECONDS, AUTH_PATH));
    redirect(res, 302, begun.url);
  }

  async function callback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const clearLogin = cookie(LOGIN_COOKIE, "", 0, AUTH_PATH);
    const raw = readCookie(req, LOGIN_COOKIE);
    const tx = raw ? loginSealer.open<LoginTransaction & { exp: number }>(raw) : null;
    // A missing/expired transaction is answered with a page, never a fresh
    // login redirect — with cookies blocked that would loop forever.
    if (!tx || tx.exp < Date.now()) {
      res.setHeader("Set-Cookie", clearLogin);
      return sendPage(req, res, 400, "signInExpired");
    }
    let result: Awaited<ReturnType<OidcClient["completeLogin"]>>;
    try {
      result = await oidc.completeLogin(
        new URL(`${config.publicUrl}${CALLBACK_PATH}${url.search}`),
        tx,
      );
    } catch (error) {
      log.warn("sign-in rejected", { error });
      res.setHeader("Set-Cookie", clearLogin);
      return sendPage(req, res, 400, "signInFailed");
    }
    const { claims, idToken } = result;
    const role = resolveRole(extractRoles(claims, config.rolesClaim, config.rolesOwner), config);
    const previous = currentSession(req);
    if (previous) sessions.delete(previous.id);
    const id = sessions.create(
      {
        sub: String(claims.sub),
        ...optionalString("name", claims.name ?? claims.preferred_username),
        ...optionalString("email", claims.email),
        role,
        idToken,
      },
      config.sessionTtlSeconds,
    );
    log.info("signed in", { role: role ?? "none" });
    res.setHeader("Set-Cookie", [clearLogin, cookie(SESSION_COOKIE, id, config.sessionTtlSeconds)]);
    redirect(res, 302, tx.returnTo);
  }

  async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const current = currentSession(req);
    // Without RP-initiated logout the IdP session stays live, so "/" would sign
    // the user straight back in; land on a page that waits for them instead.
    let location = `${AUTH_PATH}/signed-out`;
    if (current) {
      sessions.delete(current.id);
      try {
        location = (await oidc.logoutUrl(current.session.idToken)) ?? location;
      } catch (error) {
        log.warn("RP-initiated logout unavailable; signed out locally", { error });
      }
    }
    res.setHeader("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
    redirect(res, 303, location);
  }

  async function authRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = url.pathname.slice(AUTH_PATH.length);
    if (req.method === "GET" && route === "/login") return login(req, res, url);
    if (req.method === "GET" && route === "/callback") return callback(req, res, url);
    if (req.method === "POST" && route === "/logout") {
      if (!originAllowed(req)) return csrfRejected(res);
      return logout(req, res);
    }
    if (req.method === "GET" && route === "/signed-out")
      return sendPage(req, res, 200, "signedOut");
    if (req.method === "GET" && route === "/me") {
      const current = currentSession(req);
      if (!current) return unauthenticated(res);
      const { sub, name, email, role } = current.session;
      return sendJson(res, 200, { enabled: true, user: { sub, name, email }, role });
    }
    return sendJson(res, 404, { error: { code: "not_found", message: "auth route not found" } });
  }

  return {
    async authorize(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === AUTH_PATH || url.pathname.startsWith(`${AUTH_PATH}/`)) {
        await authRoute(req, res, url);
        return null;
      }

      const current = currentSession(req);
      if (!current) {
        if (isPageLoad(req)) {
          sendLoginRedirectPage(res, `${url.pathname}${url.search}`);
        } else {
          unauthenticated(res);
        }
        return null;
      }
      const { sub, name, email, role } = current.session;
      if (!role) {
        if (isPageLoad(req)) {
          sendPage(req, res, 403, "noAccess");
        } else {
          forbidden(res, "no_role", "your account has no role for this knowledge base");
        }
        return null;
      }
      if (!originAllowed(req)) {
        csrfRejected(res);
        return null;
      }
      if (requiredRole(req.method ?? "GET", url.pathname) === "editor" && role !== "editor") {
        forbidden(res, "forbidden", "editor role required");
        return null;
      }
      const principal: Principal = {
        sub,
        role,
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
      };
      principals.set(req, principal);
      // Everything past the gate is per-user (chats, job results): no cache keeps
      // it, shared or browser, unless a handler sets its own policy (the SPA shell,
      // hashed static assets, the core proxy).
      res.setHeader("Cache-Control", "no-store");
      return principal;
    },
    principalOf: (req) => principals.get(req),
  };
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value ? ({ [key]: value } as Record<K, string>) : {};
}

function isPageLoad(req: IncomingMessage): boolean {
  const method = req.method ?? "GET";
  return (
    (method === "GET" || method === "HEAD") && (req.headers.accept ?? "").includes("text/html")
  );
}

// The SPA routes by hash (#chat, the shareable #MB-Web link), which never
// reaches the server — so a signed-out page load gets a tiny page that sends the
// browser to login with the *full* return path. Its CSP admits exactly this
// script by hash; without JS, a meta refresh still keeps path + query.
const LOGIN_REDIRECT_SCRIPT = `location.replace("${AUTH_PATH}/login?returnTo="+encodeURIComponent(location.pathname+location.search+location.hash))`;
const LOGIN_REDIRECT_CSP = `default-src 'none'; script-src 'sha256-${createHash("sha256")
  .update(LOGIN_REDIRECT_SCRIPT)
  .digest("base64")}'`;

function sendLoginRedirectPage(res: ServerResponse, returnTo: string): void {
  const fallback = `${AUTH_PATH}/login?returnTo=${encodeURIComponent(returnTo)}`;
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", LOGIN_REDIRECT_CSP);
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title>` +
      `<noscript><meta http-equiv="refresh" content="0;url=${fallback}"></noscript>` +
      `<script>${LOGIN_REDIRECT_SCRIPT}</script></head><body></body></html>`,
  );
}

function redirect(res: ServerResponse, status: number, location: string): void {
  res.statusCode = status;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function unauthenticated(res: ServerResponse): void {
  sendJson(res, 401, { error: { code: "unauthenticated", message: "sign in required" } });
}

function forbidden(res: ServerResponse, code: string, message: string): void {
  sendJson(res, 403, { error: { code, message } });
}

function csrfRejected(res: ServerResponse): void {
  forbidden(res, "csrf_origin_mismatch", "cross-origin state-changing request rejected");
}

// The few pages the server renders itself (before/outside the SPA). One
// language per response, picked from Accept-Language.
const PAGES = {
  en: {
    noAccess: [
      "No access",
      "Your account is signed in but has no role for this knowledge base. Ask an administrator for access.",
    ],
    signInFailed: ["Sign-in failed", "The identity provider's response could not be verified."],
    signInExpired: [
      "Sign-in expired",
      "The sign-in attempt expired or your browser blocked its cookie.",
    ],
    idpUnavailable: [
      "Sign-in unavailable",
      "The identity provider could not be reached. Try again shortly.",
    ],
    signedOut: ["Signed out", "You have signed out of this knowledge base."],
    signOut: "Sign out",
    signIn: "Sign in",
    retry: "Try again",
  },
  "zh-CN": {
    noAccess: ["无访问权限", "你已登录，但账号没有本知识库的角色。请联系管理员开通。"],
    signInFailed: ["登录失败", "无法校验身份提供方返回的结果。"],
    signInExpired: ["登录已过期", "本次登录已过期，或浏览器拦截了登录 Cookie。"],
    idpUnavailable: ["暂时无法登录", "无法连接身份提供方，请稍后再试。"],
    signedOut: ["已退出登录", "你已退出本知识库。"],
    signOut: "退出登录",
    signIn: "登录",
    retry: "重试",
  },
} as const;

type PageId = "noAccess" | "signInFailed" | "signInExpired" | "idpUnavailable" | "signedOut";

function sendPage(req: IncomingMessage, res: ServerResponse, status: number, page: PageId): void {
  const copy = /^zh\b/i.test(req.headers["accept-language"] ?? "") ? PAGES["zh-CN"] : PAGES.en;
  const [title, detail] = copy[page];
  const action =
    page === "noAccess"
      ? `<form method="post" action="${AUTH_PATH}/logout"><button type="submit">${copy.signOut}</button></form>`
      : `<p><a href="${AUTH_PATH}/login">${page === "signedOut" ? copy.signIn : copy.retry}</a></p>`;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // No `form-action`: browsers apply it to the Sign out form's 303 to the IdP's
  // end-session endpoint, usually another origin. The page is fully static, so
  // there is no injected form for it to stop.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.end(
    `<!doctype html><html lang="${copy === PAGES.en ? "en" : "zh-CN"}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px}` +
      `@media(prefers-color-scheme:dark){body{background:#1c1b19;color:#e8e4dc}a{color:#7cc4c4}}</style>` +
      `</head><body><h1>${title}</h1><p>${detail}</p>${action}</body></html>`,
  );
}
