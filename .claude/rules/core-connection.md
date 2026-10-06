---
paths:
  - "vite.config.ts"
  - "packages/web-server/src/agent/{http,vitePlugin}.ts"
  - "packages/web-client/src/connection/**"
  - "src/config/connection.ts"
  - "src/pages/SettingsPage.tsx"
---

# Core connection

Read this rule before you change how the browser or the sidecar reaches the core.

- Default visible core URL: `http://127.0.0.1:8765`. When this exact default is in use, browser `/v1` calls go through the same-origin Vite proxy (see `vite.config.ts` `server.proxy`) to avoid CORS. Any non-default custom URL is requested directly.
  - The sidecar's outbound `/agent` core calls run server-side and **bypass** that browser proxy — they dial the core URL the browser sent. So in a proxied dev setup (`VITE_DIKW_PROXY_TARGET=… npm run dev`, or `live:verify`), where the browser keeps `serverUrl` at the default and relies on the proxy, the sidecar would otherwise dial the unused default port and every agent tool fails with `fetch failed`. `agentSidecarPlugin` (`packages/web-server/src/agent/vitePlugin.ts`) therefore **injects** the Vite-resolved `VITE_DIKW_PROXY_TARGET` (via `configResolved`, so it honors `.env.local` like the proxy itself, and warns on a malformed value) into the handler, and `applyDevProxyTarget` (`packages/web-server/src/agent/http.ts`) **mirrors the Vite `/v1` proxy**: a browser-sent *default* core URL is routed to that target. Dev-only **by construction** — the standalone production sidecar injects no target, so the rewrite can't happen in prod (and a custom, directly-reachable `serverUrl` is left untouched). The `live:verify` agent↔core check exercises this exact path (sends the default URL, asserts a core tool **succeeds**).
- Workbench connection, locale, theme and panel state live in `localStorage`, namespaced `dikw-web.*`. Settings buffers server URL/token and commits on explicit Save; Clear resets immediately. The browser token is at rest by default, and auth mode ignores it in favor of the BFF. Independent MB owns its connection and identity-scoped browser storage. The legacy backup notice follows workbench theme via the shared `useTheme` hook; it does not read connection keys or call Core.
- The top bar may show connection target/token posture but must never display the token value. In auth mode it shows the signed-in user + role instead.
