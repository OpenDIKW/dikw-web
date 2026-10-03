# 6. Opt-in OIDC auth mode (Backend-for-Frontend)

## Status

Accepted (2026-10-02). Implements [#200](https://github.com/OpenDIKW/dikw-web/issues/200).

## Context

Until now dikw-web had no notion of a user, which is fine for one person on a
laptop but not for a shared deployment:

1. Every user typed the dikw-core bearer token into Settings; it lived in
   `localStorage` and went straight to `/v1`. It could not be revoked per person,
   and any XSS could read it.
2. `/agent/*` and `/web/*` were unauthenticated, so anyone who could reach the
   port spent the LLM / Tavily / Jina / MinerU / translator keys.
3. Agent sessions were all stored under ADK `userId: "demo"`, so every user could
   list, read, rename and delete everyone else's chats.
4. The sidecar fetched a request-supplied `coreUrl` (SSRF-shaped on a shared
   server).
5. There was no read-only access level.

The deployment that asked for this already runs a self-hosted OIDC provider
(Casdoor) for its other internal apps.

## Decision

Add an **opt-in** auth mode, `DIKW_WEB_AUTH_MODE=oidc`, that turns the standalone
Node server into a Backend-for-Frontend. With the variable unset, nothing changes.

**Login** — `server/auth/oidc.ts` wraps
[`openid-client`](https://github.com/panva/openid-client) v6 (OpenID-certified;
its only dependencies are `jose` and `oauth4webapi`). Authorization Code + PKCE
(S256) with `state` and `nonce`; a confidential client (`client_secret_post`).
openid-client checks the ID token's `iss` (exactly the discovered issuer), `aud`,
`exp` and `nonce`. On top of that we turn on `enableNonRepudiationChecks`, so the
ID token signature is verified against the IdP's JWKS (cached, refetched on an
unknown `kid`), and we reject any `azp` that isn't our client id. An optional
`DIKW_WEB_OIDC_INTERNAL_URL` rewrites only the server-to-server calls (discovery,
token, JWKS) to a private origin; browser-facing URLs stay public.

**Sessions** — an opaque random id in an `HttpOnly; SameSite=Lax` cookie (`Secure`
when `DIKW_WEB_PUBLIC_URL` is https). Records live in `auth.sqlite` next to
`agent.sqlite` (Node's built-in `node:sqlite`, so no new native dependency). At rest
the file holds only the SHA-256 of each id and an AES-256-GCM-sealed record, under
a key derived from `DIKW_WEB_SESSION_SECRET` by HKDF. Sessions therefore survive a
restart, a leaked file yields no usable cookie or identity, and rotating the
secret signs everyone out. The lifetime is an absolute TTL
(`DIKW_WEB_SESSION_TTL_SECONDS`, default 8h); no refresh tokens are kept. The
in-flight login (`state`, `nonce`, PKCE verifier, return path) travels in a
second sealed, 10-minute cookie scoped to `/web/auth`, so `/login` holds no
server-side state.

**The gate** (`server/auth/gate.ts`) owns `/web/auth/{login,callback,logout,signed-out,me}`
and decides for every other request:

- no session → a page load gets a tiny page that sends the browser to login with
  the full `pathname + search + hash` (the SPA routes by hash, which never reaches
  the server; its CSP admits exactly that script by hash); an API call gets 401;
- signed in but no mapped role → 403 (an HTML page with Sign out, or JSON);
- any non-GET/HEAD/OPTIONS request must carry an `Origin` that equals
  `DIKW_WEB_PUBLIC_URL` exactly — `SameSite=Lax` alone does not cover a same-site
  origin on another port;
- `requiredRole(method, path)` (`server/auth/roles.ts`) must be met. This one
  pure function encodes the issue's capability matrix. Viewer writes are an
  **allowlist** (`POST /v1/retrieve`, `POST /v1/doc/search`), so a new core write
  endpoint is denied to viewers by default. Paths are split on `/` with empty
  segments dropped, the same normalization the `/agent` and `/web` handlers
  route by;
- an admitted request gets a default `Cache-Control: no-store`, so no cache, shared
  or the browser's, keeps one user's chats or jobs. Handlers with their own policy
  (the SPA shell, hashed static assets, the core proxy) override it.

**Sign out** is a POST to `/web/auth/logout`. It ends the local session, then
sends the browser to the IdP's end-session endpoint. Without one it lands on
`/web/auth/signed-out`, a static page with a Sign in link, not `/`: `/` would go
straight back through login, and a live IdP session would sign the user in again.

`/healthz` is the only route that stays open (the container `HEALTHCHECK`).

**Roles** come from the verified ID-token claims along `DIKW_WEB_OIDC_ROLES_CLAIM`
(`roles`, `groups`, `realm_access.roles`, `roles[].name`). Role *objects* are
dropped when `isEnabled: false` or, with `DIKW_WEB_OIDC_ROLES_OWNER`, when owned by
another organization (Casdoor). `DIKW_WEB_ROLE_VIEWER` / `_EDITOR` map role names
to the two levels; editor implies viewer. Roles are fixed at login.

**Core access** — `server/auth/coreProxy.ts` forwards same-origin `/v1/*` to
`DIKW_CORE_URL` with `Authorization: Bearer $DIKW_SERVER_TOKEN`. The browser's own
`Cookie` / `Authorization` never cross and core's `Set-Cookie` never comes back.
Request and response bodies stream (NDJSON retrieve, task-event long-poll,
multipart import), and a browser disconnect aborts the upstream request. Core's
`Cache-Control` is rewritten to `private` (its assets are `public, immutable`), so
a shared cache can't replay one user's response to another. A core `401` means
the server token is wrong, not that the user's sign-in expired, so it becomes a
`502 core_auth_failed`; passing it on would bounce the SPA through login forever. The
agent sidecar gets the same server-held connection and ignores any
request-supplied `coreUrl` / `token`.

**Per-user agent sessions** — the ADK `userId` is `oidc:<sub>`. The prefix
keeps every IdP subject out of the pre-auth `"demo"` owner, even an IdP that
literally issues `sub: "demo"`.
`AdkSessionStore.forUser()` scopes every session route to the caller, and another
user's session id is indistinguishable from a missing one (404). The pre-auth
`"demo"` sessions stay where they are. When
`DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER=<sub>` is set, that user sees them through a
**read-time merge**: listed and read from both owners, written back under the
original owner. ADK's internal tables are never rewritten.

**Per-user web jobs** ([#204](https://github.com/OpenDIKW/dikw-web/issues/204)) —
standalone supplies the gate's admitted OIDC subject to the web handler, and
`JobStore.create(controller, family, owner?)` records it on each MinerU or
translation job. Status (including progressive translated blocks), result and
cancel require both the job's family and the caller's subject to match. A
foreign id gets the same `404 not_found` as an unknown one, and a foreign cancel
never aborts the job. Auth off/dev records no owner and retains the shared flow.

The live-job cap remains **process-wide: 16 across both families and all users**.
It bounds the sidecar's total concurrent upstream work and quota consumption;
a per-user cap alone would multiply that budget with the number of users.
This does not guarantee fairness: one user can occupy every slot, and other
users then receive `503 too_many_jobs` until a slot is released. Per-user fair
admission is outside this ownership change.

**Browser** — the SPA learns the mode at boot from `GET /web/auth/me`, which
answers `{ enabled: false }` when auth is off (dev included); a 404 or a non-JSON
reply also means a server without auth mode. Anything else that doesn't settle
the question (unreachable, 5xx, a 5 s timeout, auth mode without a usable role)
fails closed to a retryable "can't reach the server" screen: guessing auth off
would bring back the browser-held core token. In auth mode the
clients go same-origin with no token and the agent gets no core URL. Settings
shows the account and a Sign out form instead of Server URL / Token. A 401 from
same-origin `/v1`, `/agent` or `/web` sends the user through sign-in once and back
to the current page (one `fetch` wrapper covers every client). Viewers don't see
Import, the Tasks maintenance toolbar / Stop, Wisdom New / favorite / Edit, or
MB-Web upload; the server enforces all of it regardless.

## Consequences

- No dikw-core change. Machine clients (`dikw client`, scripts, MCP) keep talking
  to core directly with the bearer token; routing them is the reverse proxy's job
  (see `docs/deployment.md`).
- Auth mode lives in the standalone server only. `npm run dev` always runs with
  auth off; its Vite proxy and sidecar plugins are unchanged.
- A role change at the IdP takes effect at the next sign-in (bounded by the TTL).
- With an internal URL, the IdP must keep a fixed public issuer: discovery fetched
  over the internal origin must still advertise the public `issuer`.
- New production dependency: `openid-client` (+ `jose`, `oauth4webapi`).

## Alternatives considered

- **An auth proxy in front (oauth2-proxy, Cloudflare Access).** It gates the port,
  but it can't give per-user agent sessions, can't keep the core token out of the
  browser, and needs a `/v1` bypass so the sidecar can still reach core.
- **Roles from the access token or userinfo.** Access tokens are often opaque, or
  carry an `aud` that isn't the client. Casdoor, Entra ID and Authentik put roles
  or groups in the ID token, and Keycloak does with "Add to ID token" on its
  mapper. Deferred until a provider needs it.
- **In-memory sessions.** Simpler, but every restart or redeploy signs everyone
  out, and "encrypted at rest" has nothing to apply to.
- **Moving the `"demo"` sessions by rewriting ADK's `sessions` / `events` /
  `user_states` tables.** That couples us to ADK's internal schema across
  upgrades; the read-time merge doesn't.

## Follow-ups

- Refresh-token renewal, if an absolute TTL turns out too blunt.
