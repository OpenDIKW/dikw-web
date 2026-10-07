---
paths:
  - "packages/web-server/src/auth/**"
  - "packages/web-server/src/agent/requestRouter.ts"
  - "packages/web-ui/src/auth/**"
  - "packages/web-client/src/types/auth.ts"
  - "src/Root.tsx"
  - "docs/adr/0006-oidc-auth-bff.md"
  - "docs/deployment.md"
---

# Auth mode (opt-in OIDC BFF, issue #200)

Read this rule before you change auth, sessions, roles, the request router, or any route that needs a role.

`DIKW_WEB_AUTH_MODE=oidc` turns the **standalone** server into a Backend-for-Frontend; unset (default) → behavior is unchanged, and `npm run dev` never authenticates. Design: `docs/adr/0006-oidc-auth-bff.md`; operator docs, env table and reverse-proxy recipe: `docs/deployment.md`.

- `packages/web-server/src/auth/`:
  - `config.ts` — fail-fast env loader;
  - `oidc.ts` — `openid-client` v6: code + PKCE S256, state, nonce, `iss`/`aud`/`exp`/`azp`, JWKS signature via `enableNonRepudiationChecks`, optional internal back-channel URL, refresh grants, subject-checked UserInfo fallback, token revocation and RP-initiated logout;
  - `sessionStore.ts` — `node:sqlite` `auth.sqlite` next to `agent.sqlite`, holding only the SHA-256 of each session id plus an AES-256-GCM record sealed by `seal.ts`;
  - `gate.ts` — owns `/web/auth/{login,callback,logout,signed-out,me}`; everything else gets 401 / 403 / CSRF / role checks, and an admitted request defaults to `Cache-Control: no-store` (handlers with their own policy override it). Sign out without an IdP end-session endpoint lands on `signed-out`, not `/`, which would silently sign the user back in;
  - `roles.ts` — claim-path role extraction + `requiredRole()`, the single viewer/editor capability matrix;
  - `coreProxy.ts` — streaming same-origin `/v1/*` → `DIKW_CORE_URL` with `DIKW_SERVER_TOKEN`; responses become `Cache-Control: private`, and a core 401 (bad server token) becomes `502 core_auth_failed` rather than a login loop.
- `packages/web-server/src/agent/requestRouter.ts` is the standalone top-level routing: `/healthz` is always open, then the gate (on the full path), then `/v1` → proxy, `/agent`, `/web`, static. Keep any new route behind the gate.
- Signed-out page loads get a CSP-hashed script page that redirects to login with `pathname + search + hash` (hash routes never reach the server). Unsafe methods need `Origin` exactly equal to `DIKW_WEB_PUBLIC_URL`.
- Renewable sessions (#205): refresh credentials and timestamps stay in the sealed record, never in cookies/responses/logs/OTel. Valid-origin activity slides `DIKW_WEB_SESSION_TTL_SECONDS` (default 8h), capped by `DIKW_WEB_SESSION_MAX_SECONDS` (7 days from sign-in). `DIKW_WEB_SESSION_REFRESH_SECONDS` (15 min) gates request-driven refresh and role synchronization, single-flight per session in one process. Require the original subject on new ID tokens/UserInfo; refresh failure deletes the session and returns 401 without retries. Logout revokes the current token when advertised; late refresh cannot revive a deleted/expired record. Cookie id stays stable. No-refresh providers/legacy sessions keep the fixed TTL. Default scopes are unchanged; `DIKW_WEB_OIDC_AUTH_PARAMS` allows only explicit string `access_type`/`prompt`. The SPA role updates on reload; the server enforces changes immediately after renewal.
- Viewer core writes are an **allowlist** (`POST /v1/retrieve`, `/v1/doc/search`). Every other non-GET `/v1` call, all of `/web/mineru/*` and agent proposal **confirm** need editor. The shared `JobStore` serves a job only under the `/web/<family>/jobs` prefix that created it, so a conversion id never works under the viewer-open `/web/translate`. Add new editor-only routes to `requiredRole` + `roles.test.ts`.
- Agent: ADK `userId` = `oidc:<sub>` via `createAgentHandler({ subjectFor, serverCore, legacySessionsOwner })` — namespaced so no IdP subject can be the pre-auth `demo` owner.
  - Every session route goes through `AdkSessionStore.forUser()`; a foreign or missing id → 404 (`SessionNotFoundError`).
  - `serverCore` makes the sidecar ignore request `coreUrl`/`token`.
  - `DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER` merges the pre-auth `demo` sessions into one user at read time; ADK tables are never rewritten.
- Web jobs: standalone passes the gate's OIDC `sub` through `createDefaultWebHandler(cwd, { subjectFor })`. MinerU and translation jobs record that subject as their owner; status (including partial translated blocks), result and cancel require both the matching family and owner, otherwise the same `404 not_found` as a missing id. Auth off/dev records no owner and keeps the shared flow. The live-job cap stays **process-wide: 16 across both families and all users**, bounding total upstream work; one user can exhaust it, so this is not a per-user fairness quota.
- Browser: `packages/web-ui/src/auth/index.ts` provides `loadAuth()` (from `GET /web/auth/me`, capped at 5 s; auth off → `{ enabled: false }`, which the `/web` handler answers even in dev, and a 404 / non-JSON reply also means a server without auth mode). It **fails closed**: an unreachable / 5xx / timed-out probe, or auth mode without a usable role, throws `AuthProbeError` and `src/Root.tsx` renders the retryable `StartupError` screen instead of guessing auth off, which would re-enable the browser-held core token, plus `AuthContext` / `useAuth` / `useCanEdit` and `installUnauthorizedRedirect()`. The latter is a `fetch` wrapper: a 401 from same-origin `/v1|/agent|/web` → login once, back to the current page.
  - In auth mode, App and MbApp use an empty core URL + token (same-origin, no browser token) and ignore the stored connection.
  - Settings shows the account + a Sign out form POST.
  - Viewers do not see Import, the Tasks toolbar / Stop, or Wisdom New / favorite / Edit. The server enforces the roles and the UI hides these controls. Private MB enforces its own profile and roles.
