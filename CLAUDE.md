# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the canonical operational guide and takes precedence over anything here that conflicts. Read it before non-trivial work. The deeper product/contract docs live in `docs/` (`core-contract.md`, `graph-view.md`, `ui-system.md`, `agent.md`, `tdd.md`).

## Commands

Windows shell: use `npm.cmd` (not `npm`) when invoking from PowerShell.

- `npm.cmd run dev` — Vite dev server, fixed at `http://127.0.0.1:4321` (`--strictPort`).
- `npm.cmd run typecheck` — `tsc --noEmit`.
- `npm.cmd run test` — Vitest unit/component/server tests once.
- `npm.cmd run test:watch` — Vitest watch mode.
- `npm.cmd run test:coverage` — coverage with thresholds enforced in `vite.config.ts` (statements 60 / branches 45 / functions 55 / lines 60). Do not lower these to make a feature pass.
- `npx vitest run path/to/file.test.ts` — run a single test file. Add `-t "name"` to filter by test name.
- `npm.cmd run test:e2e` — Playwright (Chromium). The config auto-starts `npm run dev` and reuses an existing server on 4321.
- `npx playwright test tests/e2e/chat.spec.ts` — run one E2E spec.
- `npm.cmd run build` — typecheck then `vite build`.
- `npm.cmd run verify` — full gate: typecheck + coverage + build + e2e. Run before committing behavior changes.

Codex-sandbox fallback when `npm.cmd run dev` fails with `Cannot read directory "../../.."`:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4321 --strictPort --configLoader runner
```

## Architecture

Read-only React/Vite knowledge workbench over `dikw-core`. The browser talks to `dikw-core` over HTTP `/v1`; the filesystem of a sibling `../dikw-core` checkout is **not** an app data source.

### Two-process model in one Vite dev server

1. **Browser app** (`src/`) — React 19 + TypeScript, no UI framework (no Tailwind/Radix/shadcn). Styling is the hand-rolled token system in `src/styles.css`; iterate within it.
2. **Agent sidecar** (`server/agent/`) — a Node middleware injected into Vite via `agentSidecarPlugin()` in `vite.config.ts`. It mounts at `/agent/*` and runs Pi Agent (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`). The browser only calls same-origin `/agent/*`; the sidecar then calls core. Sessions persist as JSON in `.agent-sessions/`. Two optional sidecar-only tools (`web_search` via Tavily, `web_fetch` via Jina) activate when `DIKW_AGENT_TAVILY_API_KEY` / `DIKW_AGENT_JINA_API_KEY` are present in `.env.agent.local`; a Brave Search client is retained in `WebToolClient.search` for future provider rotation but is not registered as an agent tool. These tools don't touch `dikw-core`.

The browser receives the current core URL from settings and passes it to the sidecar on each request. The sidecar must error on missing core URL rather than silently falling back to `.env.agent.local` (which holds local LLM credentials and is gitignored — never expose to browser/tests/screenshots).

### Core connection

- Default visible core URL: `http://127.0.0.1:8765`. When this exact default is in use, browser `/v1` calls go through the same-origin Vite proxy (see `vite.config.ts` `server.proxy`) to avoid CORS. Any non-default custom URL is requested directly.
- `serverUrl` and `token` live in `sessionStorage`; `locale` and `theme` live in `localStorage`. Keys are namespaced `dikw-web.*`.
- The top bar may show connection target/token posture but must never display the token value.

### Routes and contracts (hash-based)

`src/App.tsx` is the shell — sidebar groups, hash routing (`viewFromHash()`), `DikwClient` + `AgentClient` construction, i18n + theme wiring. Pages live in `src/pages/`.

- `#chat` is the canonical chat route. `#query` must redirect to `#chat` — do not reintroduce a Query UI or `/v1/query` calls (no longer part of the consumed core contract).
- Knowledge (`WikiPage`) uses `/v1/base/pages?active=true` and `/v1/base/pages/{path}`. Do not use the legacy `/v1/wiki/pages` endpoint.
- Graph (`GraphPage` + `components/GraphCanvas.tsx`) consumes `GET /v1/base/graph?active=true`. Scope filters (`wiki` / `source` / `all`) are applied in the web layer. Do not reintroduce browser-side body reads to build graph edges. Rendering uses Pixi.js + d3-force.
- Overview reads `/v1/health`, `/v1/status`, `/v1/info` — see `docs/core-contract.md` for which fields are authoritative (e.g. wisdom counts come from `health.layer_counts`, not `status.documents_by_layer.wisdom`).

### Markdown reader (`src/components/MarkdownView.tsx`)

Pipe tables, a sanitized raw HTML table subset, safe `details/summary`, KaTeX math, Mermaid fenced code, Obsidian-style image embeds (`![[path]]`), and chart blocks (`<details><summary>bar|line|scatter|heatmap</summary>` wrapping a pipe table). Arbitrary raw HTML, scripts, event attributes, and inline styles must not become live DOM.

Image embeds resolve through `PageReadResult.assets[]` (matching `original_paths` or the SHA-256 segment of the filename) and load from `GET /v1/assets/{asset_id}` via the Settings-owned base URL. When a session token is configured, images are hydrated through an authenticated `fetch` + `URL.createObjectURL` instead of a plain `<img src>` so the `Authorization` header is honored; missing assets render a `.md-broken-image` placeholder.

Charts use Apache ECharts, lazy-imported per-module for tree-shaking. The placeholder element carries the parsed spec as a base64-encoded `data-chart-spec`; if ECharts fails to load or a single chart fails to render, the placeholder falls back to a `<details>` block containing the source pipe table so data is never lost. Dark mode passes the `"dark"` theme to `echarts.init`.

### UI rules

- Compact knowledge-workbench feel: warm neutral surfaces, petrol accent, hairline borders, restrained shadows, small radii.
- Page chrome is single-language per current locale — no bilingual labels like `Overview / 工作台概览`. Core/user content is not translated by the web layer.
- Dark-mode Wiki reader uses reader tokens — avoid large near-white blocks.

## Testing approach

TDD for behavior changes: failing test first, smallest change to green, then refactor. Page/component tests for visible behavior; API-boundary tests for client/sidecar contracts. Playwright covers route compatibility, i18n chrome, dark contrast, markdown rendering, chat layout, and graph interactions. `src/test/setup.ts` is the Vitest setup file; `jsdom` is the test environment.

## Patch intake

Don't blindly overwrite app files from external patches. Many older patches predate current decisions (`#chat` canonical route, Settings-owned connection config, the current `styles.css` token system). Adapt the useful parts into the current architecture and update tests/docs to match.
