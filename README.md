# dikw-web

A read-only React/Vite knowledge workbench over [`dikw-core`](../dikw-core).
The browser app consumes `dikw-core`'s `/v1` HTTP API; a small Node
sidecar runs alongside the dev server and exposes same-origin `/agent/*`
routes for chat plus `/web/*` routes for browser-side helpers (currently
mineru-backed PDF / Office conversion for Import).

## Quick start

```powershell
# install
npm.cmd install

# dev server (fixed at http://127.0.0.1:4321)
npm.cmd run dev

# point Settings → Server URL at your local dikw-core (default http://127.0.0.1:8765)
```

When the visible Server URL is the default, browser `/v1` calls go through
the Vite proxy to avoid CORS; any other URL is requested directly.

## Commands (Windows PowerShell)

| Command | What it does |
|---|---|
| `npm.cmd run dev` | Vite dev server on `127.0.0.1:4321` (`--strictPort`) |
| `npm.cmd run typecheck` | `tsc --noEmit` |
| `npm.cmd run lint` | ESLint flat config, `--max-warnings 0` (hook deps, unused symbols, no browser `console`) |
| `npm.cmd run format` / `format:check` | Prettier across code (`.ts/.tsx/.js/.mjs/.css/.json`; markdown excluded) |
| `npm.cmd run test` | Vitest once (unit + component + server) |
| `npm.cmd run test:watch` | Vitest watch mode |
| `npm.cmd run test:coverage` | Vitest with coverage thresholds (60 / 45 / 55 / 60) |
| `npm.cmd run test:e2e` | Playwright (Chromium); auto-starts dev server if needed |
| `npm.cmd run build` | `tsc --noEmit` + `vite build` (browser to `dist/`) + `build:server` (esbuild to `dist-server/standalone.mjs`) |
| `npm.cmd run verify` | Full gate: lint + format:check + typecheck + coverage + build + e2e |

Single-file iteration:

```powershell
npx vitest run src/components/MarkdownView.test.tsx
npx playwright test tests/e2e/wiki.spec.ts
```

If `npm.cmd run dev` fails in the Codex sandbox with `Cannot read
directory "../../.."`, fall back to:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4321 --strictPort --configLoader runner
```

## Architecture in one diagram

```
browser (React 19, hand-rolled CSS tokens)
   │
   ├─── same-origin /v1/*   ──▶ Vite proxy ──▶ dikw-core (default core)
   │                        ──▶ direct fetch ──▶ dikw-core (custom URL)
   │
   ├─── same-origin /agent/* ──▶ Google ADK sidecar (Node middleware in Vite)
   │                                  └─── MiniMax-M3 via MiniMaxLlm (Anthropic-compatible)
   │                                  └─── calls back into dikw-core as tools
   │                                  └─── optional web_search (Tavily) / web_fetch (Jina)
   │
   └─── same-origin /web/*   ──▶ same sidecar process (server/web/)
                                      └─── /mineru/convert (PDF/Office → job id; detached convert via mineru.net)
                                      └─── /mineru/jobs/<id>[/result|/cancel] (poll / fetch result / cancel)
                                      └─── /mineru/health  (drives Import UI degradation)
```

Two source trees share a single sidecar process (mounted into the Vite
dev server as middleware, and into `dist-server/standalone.mjs` for prod):

1. **Browser app** in `src/` — React 19 + TypeScript, no UI framework.
   Hand-rolled CSS token system in `src/styles.css`.
2. **Sidecar** in `server/agent/` + `server/web/` — `/agent/*` mounted by
   `agentSidecarPlugin()` (Google ADK chat), `/web/*` mounted by
   `webApiPlugin()` (browser helpers, currently mineru conversion). Both
   live in `vite.config.ts`. Sessions persist to local SQLite in
   `.agent-sessions/agent.sqlite` (gitignored).

## Routes

Hash-based. Settings owns connection state.

- `#chat` — canonical chat. Legacy `#query` redirects here.
- `#trace` — hidden (URL-only, not in the sidebar): per-session
  conversation + an OpenTelemetry span waterfall from
  `/agent/sessions/{id}/traces`. Spans are in-memory and ephemeral.
- `#base` — Base reader (sidebar label "Base", page heading "Base" in en / "知识库" in zh-CN). Shows the `source` + `knowledge` layers; wisdom lives on `#wisdom`. Tree from `/v1/base/pages?active=true`;
  body from `/v1/base/pages/{path}`. Tabs: Read / Info / Outline / Source. The legacy `#wiki` hash no longer resolves (falls back to `#overview`).
- `#graph` — read-only knowledge map; consumes
  `/v1/base/graph?active=true`. Pixi.js + d3-force.
- `#overview`, `#wisdom`, `#tasks`, `#retrieve`, `#settings` — see
  `docs/core-contract.md` for endpoint mapping.

## Markdown reader

`src/components/MarkdownView.tsx` renders source and wiki markdown bodies.
Supports:

- Pipe tables, sanitized raw HTML tables (narrow allow-list).
- Safe `<details>/<summary>` blocks.
- KaTeX inline `$...$` and block `$$...$$`.
- Mermaid fenced code (lazy-imported; `securityLevel: "strict"`).
- Obsidian-style image embeds `![[assets/images/<sha>.jpg]]` — resolved
  through `PageReadResult.assets[]` and streamed from
  `/v1/assets/{asset_id}`. When a session token is set, images are
  hydrated via authenticated `fetch` + `URL.createObjectURL` so the
  `Authorization` header is honored.
- Chart blocks `<details><summary>bar|line|scatter|heatmap</summary>`
  wrapping a markdown pipe table — rendered with Apache ECharts
  (lazy-imported per-module). Honors dark mode. Falls back to a
  `<details>` table when the chart code fails to load, the spec is
  malformed, or `init` throws — so users never lose the source data.

Arbitrary raw HTML, scripts, event attributes, and inline styles must
not become live DOM.

## Chat sidecar

The agent runs on **Google ADK** (`@google/adk`); the LLM is MiniMax-M3
via its Anthropic-compatible endpoint through a custom `MiniMaxLlm`
adapter (`@anthropic-ai/sdk` transport). The browser only ever calls
same-origin `/agent/*` and the `AgentStreamEvent` NDJSON wire shape is
stable across the runtime. The sidecar:

- Receives the current Settings `Server URL` and optional bearer token
  on each request; rejects requests without a `coreUrl` rather than
  falling back to `.env.local`.
- Calls `dikw-core` retrieval / page / wisdom / health endpoints as
  tools.
- Optionally calls `web_search` (Tavily) and `web_fetch` (Jina) when
  `DIKW_AGENT_TAVILY_API_KEY` / `DIKW_AGENT_JINA_API_KEY` are present
  in `.env.local`. A Brave client is retained in
  `WebToolClient.search` for future provider rotation but is not
  registered as an agent tool.
- Persists sessions to local SQLite (`.agent-sessions/agent.sqlite`) via
  ADK's `DatabaseSessionService`. The stored events must not contain LLM
  keys or browser session-storage values.

Local credentials (LLM keys, optional web tool keys, `DIKW_WEB_MINERU_API_KEY`
for Import PDF / Office conversion) live in `.env.local` (gitignored
via `*.local`). Use `.env.example` as the template.

## Settings & state

- `dikw-web.serverUrl` (sessionStorage) — selected core base URL.
- `dikw-web.token` (sessionStorage) — bearer token, never displayed in
  chrome.
- `dikw-web.locale` (localStorage) — `en` or `zh-CN`, defaults to `en`.
- `dikw-web.theme` (localStorage) — `system` / `light` / `dark`,
  defaults to `system`. Applied as `html[data-theme="..."]`.

## Branding (white-label)

The sidebar logo text and browser tab title default to `OpenDIKW`
(`src/config/branding.ts`). To rebrand without rebuilding, drop a
`config.json` into the served static root (`public/` in dev, `dist/` or a
mounted volume in prod) — copy the shape from
[`public/config.example.json`](public/config.example.json):

```json
{ "brand": { "name": { "en": "Maibo-DIKW", "zh-CN": "迈博知识库" } } }
```

The app fetches `/config.json` once at startup; a missing or malformed file
falls back to the `OpenDIKW` defaults. `name` is per-locale (a bare string
applies to all locales) and the tab title follows it. `config.json` is
gitignored so per-deployment branding never lands in the repo. The logo
image and favicon are fixed — only text is configurable. The breadcrumb
root is a fixed `Workbench` / `工作台` label, independent of the brand.

## Testing

TDD for behavior changes: failing test first, smallest change to green,
then refactor. Vitest (jsdom) covers components, utilities, the client
boundary, and the sidecar; Playwright (Chromium) covers routes, i18n
chrome, dark-mode contrast, markdown rendering (including image and
chart fixtures via `tests/e2e/mockApi.ts`), chat layout, and graph
interactions. Coverage thresholds live in `vite.config.ts`; don't
lower them to make a feature pass.

## Deployment

For production, build and run as a single self-contained Node service that
serves the SPA plus the same-origin `/agent/*` sidecar. LLM credentials are
injected via env; users still pick the external dikw-core URL in Settings.

```powershell
npm.cmd run build   # produces dist/ and dist-server/
npm.cmd start       # node dist-server/standalone.mjs
```

A Docker image is the recommended deployment form. See
[`docs/deployment.md`](docs/deployment.md) for required env vars, the
`docker run` / `docker compose` recipes, and notes on connecting to an
external dikw-core (host networking + CORS).

## Where canonical docs live

- `CLAUDE.md` — operational guide for Claude Code sessions (working
  principles, architecture, testing, patch intake).
- `docs/deployment.md` — production deploy (Docker, env vars, networking).
- `docs/core-contract.md` — the `dikw-core` HTTP subset this app
  consumes (Settings, Overview, Base Pages, Assets, Graph, Chat, Tasks).
- `docs/ui-system.md` — visual tokens, markdown reader contract,
  graph canvas rules, components.
- `docs/graph-view.md` — Graph View architecture and rendering.
- `docs/agent.md` — ADK agent sidecar (MiniMaxLlm, ADK runner/session
  store, sqlite sessions, OpenTelemetry `#trace`), tool registry.
- `docs/tdd.md` — TDD workflow for this project.
- `docs/adr/` — Architecture Decision Records (one decision per file,
  prefixed `NNNN-`).

## Project layout

```
src/
  api/             DikwClient + AgentClient + NDJSON helpers
  components/      MarkdownView, GraphCanvas, shared UI pieces
  pages/           one file per top-level route (Wiki, Graph, Chat, …)
  utils/           pure helpers (chart-spec, markdown frontmatter, graph adapters, format)
  styles.css       hand-rolled token system — the UI baseline
server/agent/      ADK agent sidecar, MiniMaxLlm, tools, sqlite session storage
tests/e2e/         Playwright specs + mockApi fixtures
docs/              canonical product/contract notes (see above)
```
