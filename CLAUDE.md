# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deeper product/contract docs live in `docs/` (`core-contract.md`, `graph-view.md`, `ui-system.md`, `agent.md`, `tdd.md`). Read the relevant ones before non-trivial work.

## Working principles

These bias toward caution over speed; use judgment for trivial edits.

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions out loud. When a root cause depends on data shape, verify against the live API (`/v1/health`, `/v1/base/graph`, `/v1/base/pages/{path}/links`) before designing around it — a plausible cause is not a confirmed one.
- If multiple interpretations of a request exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what's confusing, and ask.

### Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked; no abstractions for single-use code.
- No flexibility/configurability that wasn't requested; no error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.
- The aesthetic backs this up: no UI framework, hand-rolled tokens in `src/styles.css`, restrained shadows — don't pull in a library when the token system already covers it.

### Surgical changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting in unrelated areas. Match existing style even if you'd write it differently.
- Don't refactor things that aren't broken — `#chat` canonical route, Settings-owned connection config, the current `styles.css` tokens (see Patch intake).
- If you notice unrelated dead code, mention it; don't delete it.
- Remove imports/variables/functions that *your* changes orphaned; leave pre-existing dead code alone unless asked.
- Every changed line should trace to the request.

### Goal-driven execution

Define success criteria. Loop until verified.

TDD is the default loop (see `docs/tdd.md` and §Testing approach): failing test first → smallest change to green → refactor. Restate vague requests as verifiable goals before coding:

- "Add validation" → write tests for invalid inputs, then make them pass.
- "Fix the bug" → write a failing test that reproduces it, then make it pass.
- "Refactor X" → tests pass before and after.

For multi-step work, state a brief plan with a check per step (`npx vitest run …`, `npm.cmd run typecheck`, a `curl` against `/v1/...`, a Chrome MCP screenshot). `npm.cmd run verify` is the final gate before claiming a behavior change is done — don't lower the coverage thresholds in `vite.config.ts` to make a feature pass.

Strong success criteria let you loop independently; "make it work" requires constant clarification.

Working when: fewer unnecessary diffs, fewer rewrites from over-engineering, clarifying questions land *before* implementation rather than after.

## Delivery workflow

End-to-end loop from request to landed PR. Run autonomously for behavior changes — don't wait for the user to prompt each step. Steps run in order; skip only with an explicit reason.

1. **Clarify the request.** Restate it, surface assumptions, and ask before assuming. For non-trivial scope, build a plan with the `drill-me-with-docs` or `superpowers` planning skill before touching code.
2. **Write the plan in the user's language.** Plan body follows the user's writing language (Chinese / English); code, identifiers, file paths, and commands stay English. Plans default to TDD: failing test first, smallest change to green, refactor (see `docs/tdd.md`).
3. **Code-review loop — max 3 rounds by default.** Repeat until there are no new actionable findings or the cap is reached:
   - 3.1 Run `/codex:review --background` for an independent review pass.
   - 3.2 Evaluate the findings, decide which are valid, and fix.
4. **Final pass.** Run `/code-review` and resolve every finding before continuing.
5. **Verify in the browser.** Use Chrome MCP to navigate the changed pages, exercise the affected interactions, and confirm the change actually rendered as intended — not just that unit tests pass.
6. **Update markdown docs.** Walk `CLAUDE.md`, `README.md`, and the relevant `docs/*.md` against the diff; any contract, behavior, command, or doc index that drifted must be updated in the same change. Don't leave docs to "catch up later".
7. **Create the PR.** Branch with a descriptive name, commit with `<type>(<scope>): <subject>` matching the project's existing convention (see recent `git log`), push, then `gh pr create`. CI auto-runs typecheck + coverage + build + e2e + Trivy. Bump `package.json.version` manually (standard 3-digit SemVer) when the change warrants it, and add an entry to `CHANGELOG.md` under the matching version heading.
8. **Monitor CI and PR comments; resolve as they surface, then merge.** After pushing, actively watch both signals — don't passively wait, and don't batch resolution to merge time.
   - **CI rollup**: `gh pr checks <N>` (or `--watch` to block until terminal). Failing job logs: `gh run view <run-id> --log-failed`. Flaky e2e gets **one** rerun, not five (see [[project_flaky_graph_e2e]] in memory for which test).
   - **PR review prose**: `gh api repos/{owner}/{repo}/pulls/{N}/reviews` for review bodies, `.../pulls/{N}/comments` for inline threads, `.../issues/{N}/comments` for top-level CodeRabbit summaries. `gh pr checks` shows pass/fail only, not the prose.
   - **Resolve each finding** as it appears: fix + re-push (CodeRabbit/CI sees the new SHA and re-evaluates), refute with evidence in a reply, or defer explicitly with a rationale in the PR body.
   - **Merge**: `gh pr merge <N> --squash --delete-branch` once CI is fully green and every actionable comment is resolved or explicitly dismissed.

For trivial edits (typo, comment, single-line refactor), use judgment and skip the loop.

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
- `npm.cmd run build` — typecheck, `vite build` (browser bundle to `dist/`), then `build:server` (esbuild bundles `server/agent/standalone.ts` to `dist-server/standalone.mjs`). `npm.cmd start` runs that standalone sidecar.
- `npm.cmd run verify` — full gate: typecheck + coverage + build + e2e. Run before committing behavior changes.

Codex-sandbox fallback when `npm.cmd run dev` fails with `Cannot read directory "../../.."`:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4321 --strictPort --configLoader runner
```

## Architecture

Read-only React/Vite knowledge workbench over `dikw-core`. The browser talks to `dikw-core` over HTTP `/v1`; the filesystem of a sibling `../dikw-core` checkout is **not** an app data source.

### Two-process model in one Vite dev server

1. **Browser app** (`src/`) — React 19 + TypeScript, no UI framework (no Tailwind/Radix/shadcn). Styling is the hand-rolled token system in `src/styles.css`; iterate within it.
2. **Sidecar** (`server/agent/` + `server/web/`) — a Node middleware injected into Vite that serves two same-origin prefixes:
   - `/agent/*` (`server/agent/`, mounted by `agentSidecarPlugin()`) runs Pi Agent (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`). The browser only calls same-origin `/agent/*`; the sidecar then calls core. Sessions persist as JSON in `.agent-sessions/`. Two optional sidecar-only tools (`web_search` via Tavily, `web_fetch` via Jina) activate when `DIKW_AGENT_TAVILY_API_KEY` / `DIKW_AGENT_JINA_API_KEY` are present in `.env.agent.local`; a Brave Search client is retained in `WebToolClient.search` for future provider rotation but is not registered as an agent tool. These tools don't touch `dikw-core`.
   - `/web/*` (`server/web/`, mounted by `webApiPlugin()`) hosts dikw-web's own browser helpers — currently `POST /web/mineru/convert?inputSha=<hex>` (multipart in, tar.gz out) and `GET /web/mineru/health`. Used by ImportPage to convert PDF / Office files into markdown + assets via mineru.net before joining the existing `/v1/import` pipeline. Activates when `MinerUAPIKey` (alias `DIKW_AGENT_MINERU_API_KEY`) is set in `.env.agent.local`; missing key → `503 mineru_disabled` and the UI degrades to `.md/.pdf` only. `/web/*` does not touch `dikw-core`. Future browser-side conversion helpers (OCR, video transcripts, ...) go here, not under `/agent/*`.

Both prefixes are served by the same Node process in dev and in the standalone `dist-server/standalone.mjs` build. The browser receives the current core URL from settings and passes it to the sidecar on each request. The sidecar must error on missing core URL rather than silently falling back to `.env.agent.local` (which holds local LLM credentials and is gitignored — never expose to browser/tests/screenshots). `.agent-sessions/`, `.tmp/`, `coverage/`, `dist/`, `dist-server/`, `test-results/`, and `playwright-report/` are local/generated — don't commit them or treat them as source.

### Core connection

- Default visible core URL: `http://127.0.0.1:8765`. When this exact default is in use, browser `/v1` calls go through the same-origin Vite proxy (see `vite.config.ts` `server.proxy`) to avoid CORS. Any non-default custom URL is requested directly.
- `serverUrl` and `token` live in `sessionStorage`; `locale` and `theme` live in `localStorage`. Keys are namespaced `dikw-web.*`.
- The top bar may show connection target/token posture but must never display the token value.

### Routes and contracts (hash-based)

`src/App.tsx` is the shell — sidebar groups, hash routing (`viewFromHash()`), `DikwClient` + `AgentClient` construction, i18n + theme wiring. Pages live in `src/pages/`.

- `#chat` is the canonical chat route. `#query` must redirect to `#chat` — do not reintroduce a Query UI or `/v1/query` calls (no longer part of the consumed core contract).
- Base (`WikiPage`) uses `/v1/base/pages?active=true` and `/v1/base/pages/{path}`. Do not use the legacy `/v1/wiki/pages` endpoint. The sidebar label and page heading say "Base" in en (matching the `/v1/base/*` core endpoint family) and "知识库" in zh-CN.
- Graph (`GraphPage` + `components/GraphCanvas.tsx`) consumes `GET /v1/base/graph?active=true` and renders the full active graph. Only `search` and `hide-orphans` are exposed as client-side filters — the `wiki` / `source` / `all` scope toggle was removed; do not reintroduce it (see `docs/graph-view.md`). Do not reintroduce browser-side body reads to build graph edges. Rendering uses Pixi.js + d3-force.
- Overview reads `/v1/health`, `/v1/status`, `/v1/info` — see `docs/core-contract.md` for which fields are authoritative (e.g. wisdom counts come from `health.layer_counts`, not `status.documents_by_layer.wisdom`).
- `#import` (`ImportPage`) is the only write surface: browser bundles `.md` + referenced assets into a tar.gz + manifest (per `routes_import.py` wire shape), POSTs to `/v1/import`, then runs ingest → synth → lint (propose + user-reviewed apply). Pipeline state persists in `sessionStorage["dikw-web.importPipeline"]` (per-tab, scoped to the active core URL) so a refresh during any async task resumes polling; upload itself is non-resumable. When `/web/mineru/health` reports `enabled=true`, ImportPage also accepts `.pdf / .doc / .docx / .ppt / .pptx / .xls / .xlsx` — those files run through a `converting` pre-stage (`/web/mineru/convert`) to produce markdown + assets, which then flow into the same bundle. `converting` is non-resumable on refresh in v1 (the IndexedDB + mineru server caches keyed by input SHA-256 typically make re-conversion millisecond-fast for the same bytes). Same input bytes → identical `package_sha256` so core's dedup continues to work. See `docs/core-contract.md#import`.

### Chat / agent rules

- Chat right-rail context is session-scoped accumulated sources/tool calls, not per-turn filtering. Don't "fix" this by filtering per turn.
- The agent prefers core tools (DIKW retrieval) and falls back to `web_search` / `web_fetch` only when core can't answer.
- Maintenance actions (destructive operations on core) must be proposed by the agent and explicitly confirmed by the user before calling the corresponding core endpoint — never auto-execute.

### Markdown reader (`src/components/MarkdownView.tsx`)

Pipe tables, a sanitized raw HTML table subset, safe `details/summary`, KaTeX math, Mermaid fenced code, Obsidian-style image embeds (`![[path]]`), and chart blocks (`<details><summary>bar|line|scatter|heatmap</summary>` wrapping a pipe table). Arbitrary raw HTML, scripts, event attributes, and inline styles must not become live DOM.

Image embeds resolve through `PageReadResult.assets[]` (matching `original_paths` or the SHA-256 segment of the filename) and load from `GET /v1/assets/{asset_id}` via the Settings-owned base URL. When a session token is configured, images are hydrated through an authenticated `fetch` + `URL.createObjectURL` instead of a plain `<img src>` so the `Authorization` header is honored; missing assets render a `.md-broken-image` placeholder.

Charts use Apache ECharts, lazy-imported per-module for tree-shaking. The placeholder element carries the parsed spec as a base64-encoded `data-chart-spec`; if ECharts fails to load or a single chart fails to render, the placeholder falls back to a `<details>` block containing the source pipe table so data is never lost. Dark mode passes the `"dark"` theme to `echarts.init`.

Source 层 read tab 在渲染前会跑 `injectInlineRefs`(`src/utils/source-inline-refs.ts`),
把已有反向边的 K 页 title 在 body 首次出现位置合成 `[[title|literal]]` wikilink。
未匹配上的 K 页留在底部 Linked references panel。Source tab 永远显示原始 `page.body`。
设计细节见 `docs/adr/0002-source-inline-references.md`。

### UI rules

- Compact knowledge-workbench feel: warm neutral surfaces, petrol accent, hairline borders, restrained shadows, small radii.
- Page chrome is single-language per current locale — no bilingual labels like `Overview / 工作台概览`. Core/user content is not translated by the web layer.
- Dark-mode Wiki reader uses reader tokens — avoid large near-white blocks.
- Don't add a UI framework (shadcn / Radix / Tailwind / etc.) without an explicit plan — work within the `src/styles.css` token system.

## Testing approach

TDD for behavior changes: failing test first, smallest change to green, then refactor. Page/component tests for visible behavior; API-boundary tests for client/sidecar contracts. Playwright covers route compatibility, i18n chrome, dark contrast, markdown rendering, chat layout, and graph interactions. `src/test/setup.ts` is the Vitest setup file; `jsdom` is the test environment.

## Patch intake

Don't blindly overwrite app files from external patches. Many older patches predate current decisions (`#chat` canonical route, Settings-owned connection config, the current `styles.css` token system). Adapt the useful parts into the current architecture and update tests/docs to match.
