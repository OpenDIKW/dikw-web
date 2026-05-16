# dikw-web Agent Notes

This file is the short operational guide for Codex/agent work in this
repository. Keep durable product and contract details in `docs/`, but
record high-impact workflow rules here so future sessions do not relearn
them from scratch.

## Project Shape

- `dikw-web` is a React/Vite read-only knowledge workbench over
  `dikw-core`.
- The browser app consumes `dikw-core` through `/v1` APIs. Do not read
  the sibling `../dikw-core` filesystem for app data.
- The canonical Chat route is `#chat`. Legacy `#query` must redirect to
  `#chat`; do not reintroduce Query UI or `/v1/query` calls.
- The Knowledge route uses `/v1/base/pages?active=true` and
  `/v1/base/pages/{path}`. The legacy `/v1/wiki/pages` endpoint is not
  part of the current contract.
- Graph View consumes `GET /v1/base/graph?active=true` and applies
  `wiki` / `source` / `all` scopes in the web layer. Do not reintroduce
  browser-side body reads to build graph edges.

## Local Runtime

- The dev server port is fixed at `127.0.0.1:4321`.
- The default visible core URL is `http://127.0.0.1:8765`.
- Server URL and token live in browser `sessionStorage`; locale and theme
  live in `localStorage`.
- If `npm.cmd run dev` fails in the Codex sandbox with
  `Cannot read directory "../../..": Access is denied`, run Vite with the
  runner config loader:

  ```powershell
  node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4321 --strictPort --configLoader runner
  ```

- `.env.agent.local` contains local LLM credentials and is ignored by
  Git. Never expose those values to browser code, tests, screenshots, or
  committed docs.
- `.agent-sessions/`, `.tmp/`, `coverage/`, `dist/`, `test-results/`,
  and `playwright-report/` are local/generated data.

## Development Rules

- Follow TDD for behavior changes: write or update the failing test first,
  implement the smallest change, then refactor while green.
- Prefer page/component tests for visible behavior and API-boundary tests
  for client/sidecar contracts.
- Run the smallest relevant test while iterating. Before committing
  behavior changes, run `npm.cmd run verify`.
- Use Playwright E2E for UI regressions such as route compatibility,
  i18n chrome, dark reader contrast, markdown rendering, chat layout, and
  graph interactions.
- Do not lower coverage thresholds to pass a feature. Add or repair tests.

## UI Direction

- `src/styles.css` is the current baseline UI specification. Iterate
  within that token system unless a future design explicitly replaces it.
- The app should feel like a compact knowledge workbench: warm neutral
  surfaces, petrol accent, hairline borders, restrained shadows, small
  radii, and dense but readable information layouts.
- Do not add shadcn, Radix, Tailwind, or another UI framework without an
  explicit plan.
- Page chrome must be single-language according to the current locale.
  Do not render bilingual labels such as `Overview / 工作台概览`.
- Core/user content is not translated by the web layer.
- Dark mode Wiki reader must use reader tokens and avoid large near-white
  blocks.

## Markdown Reader

- Markdown rendering supports pipe tables, a sanitized raw HTML table
  subset, safe `details/summary`, KaTeX math, and Mermaid fenced code.
- Do not enable arbitrary raw HTML. Scripts, event attributes, styles, and
  non-allow-listed HTML must not become live DOM.
- Image asset loading is intentionally not solved yet. Treat it as a
  separate future asset/proxy slice.

## Chat Sidecar

- Browser calls same-origin `/agent/*`; the Node sidecar runs Pi Agent.
- The sidecar receives the current core URL from the browser request. If
  the core URL is missing, it should return a clear request error rather
  than silently falling back to `.env.agent.local`.
- Sessions are persisted as JSON files in `.agent-sessions/`.
- Chat right-rail context is session-scoped accumulated sources/tool
  calls, not per-turn filtering.
- The sidecar can also call Tavily (`web_search`) and Jina Reader
  (`web_fetch`) as optional tools. Their keys live in `.env.agent.local`
  as `DIKW_AGENT_TAVILY_API_KEY` / `DIKW_AGENT_JINA_API_KEY` and must
  never enter session JSON, browser code, screenshots, or commits. The
  Agent prefers core tools and falls back to web tools only when core
  cannot answer. A Brave Search client is retained in
  `WebToolClient.search` for future provider rotation but is not
  currently exposed to the agent.
- Maintenance actions must be proposed by the Agent and explicitly
  confirmed by the user before calling core maintenance endpoints.

## Patch Intake

- Do not blindly overwrite core app files from external patches.
- Check whether a patch predates current decisions such as `#chat`,
  Settings-owned connection configuration, or the current CSS system.
- Prefer adapting the useful parts into the current architecture, then
  update tests and docs.
