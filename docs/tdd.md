# dikw-web TDD Workflow

This project uses a pragmatic red-green-refactor loop. Tests should describe user-visible behavior through public interfaces: rendered UI, the `DikwClient` boundary, and browser-visible flows. Avoid tests that assert private helper wiring unless that helper is intentionally exported as a small public module.

## Daily Loop

1. Write one failing behavior test for the next visible capability.
2. Implement the smallest change that makes it pass.
3. Refactor only while all tests are green.
4. Run the smallest useful command while iterating, then `npm run verify` before committing.

## Core Contract Changes

When `dikw-core` changes its HTTP contract, adapt `dikw-web` as vertical
behavior slices instead of one broad rewrite:

1. Add or update one page-level test that describes the new user-visible
   behavior through `DikwClient` calls and rendered UI.
2. Update fixtures to the new wire shape used by that test.
3. Change the smallest page/type/client code needed for that behavior.
4. Run the target test, then repeat for the next endpoint or event shape.

Prefer testing the rendered page contract over asserting internal helper
names. Endpoint paths, request params, visible summaries, and error
states are stable enough to test because they are the web app's public
boundary with `dikw-core`.

## Graph View Slice Example

Graph View followed the same vertical loop:

1. App shell test first: add the localized `Graph` navigation entry,
   click it, and assert `#graph` plus the current-locale page heading.
2. Graph adapter unit test next: feed a `GET /v1/base/graph` payload,
   map it to the render graph, preserve edge weight, and sum unresolved
   `count` values.
3. Page test then covers the API boundary: load
   `/v1/base/graph?active=true`, render the complete active graph, then
   verify search, hide-orphans, focus, and open-in-Wiki. The
   page should also assert removed controls stay removed, such as
   `wiki` / `source` / `all` scope toggles and force sliders.
4. E2E mock locks the user path: navigate to `#graph`, click a node,
   inspect detail, assert graph loading did not loop through
   `/v1/base/pages/{path}`, and open it in the Wiki
   reader. Include both wiki and source nodes so `WikiPage.initialPath`
   cannot regress to the default page while the page list is loading.

Pixi canvas work adds a pure utility slice before page integration:
derive a deterministic galaxy graph, compute stable clusters, lay out
nodes without mutating inputs. This
keeps implementation choices replaceable while the visible graph
behavior stays protected.

Large-graph readability is also testable. Add unit tests that force a
hub-heavy graph into the renderer and assert compact node/edge sizing,
fallback communities when Louvain collapses, broad canvas span, and
minimum cluster separation before tuning Pixi colors or layout forces.
Performance-sensitive visual decisions should be locked as contracts too:
for example, assert the graph package does not reintroduce a Bloom/halo
dependency when the product direction is a cheaper, cleaner overview.

## Wiki Reader Slice Example

Wiki reader changes should land as vertical UI slices:

1. App shell first: assert removed routes, such as `#artifacts`, fall back
   to Overview and have no sidebar item.
2. Page test next: open `#base`, assert the default `Read` tab,
   rendered HTML body, and absence of any report-generation button.
3. Add tab behavior one slice at a time: `Info` for frontmatter and
   core metadata, `Outline` for headings and wikilinks, and `Source`
   for raw Markdown.
4. Link regression stays close to the user bug: clicking in-document
   heading links must not change the app hash away from `#base`, and
   wikilinks must open the right preview panel instead of navigating the
   main document.
5. E2E smoke covers the same browser path with mocked `/v1` data and
   checks desktop/mobile overflow.
6. Source-page reverse-edge channels (body backlinks via `/links` and
   frontmatter provenance via `/provenance`) land as a single vertical
   slice: first a `resolveDerivedPages` + `mergeSourceReferences` util
   test, then a `WikiPage` test that merges the two responses into the
   `Linked references` panel with `linked` / `sourced` chips, then an
   e2e that drives the same browser flow against a fixture.

This keeps the structured reading layer inside Wiki, where users already
expect it, while leaving Tasks, Chat, Retrieve, and Graph as their
own views.

## Markdown Table and Math Slice Example

Reader rendering fixes should be driven by narrow red-green slices:

1. Add `MarkdownView` tests that prove raw `<table>...</table>` input
   becomes a real table wrapped by `.markdown-table-wrap`, while
   non-table HTML, scripts, and event attributes do not become live DOM.
2. Add formula tests for inline `$...$` and block `$$...$$` input that
   assert KaTeX DOM is rendered and the raw delimiter text is not shown.
3. Extend the Wiki E2E fixture with a raw table and formulas, then assert
   the browser sees `.markdown-table-wrap table` and `.katex` without
   horizontal overflow.
4. Only then implement the smallest renderer changes: keep
   `markdown-it` HTML disabled, restore a sanitized table allow-list,
   and route formulas through KaTeX with a text fallback on parse errors.
5. Image asset loading is a separate future slice. Do not add image
   tests to table/math work unless that future slice is explicitly in
   scope.

## Details and Mermaid Slice Example

Markdown disclosure and diagram fixes should stay inside the same safe
reader boundary:

1. Add `MarkdownView` tests that prove safe
   `<details><summary>...</summary>...</details>` input becomes real
   disclosure DOM, preserves the `open` attribute, and still escapes
   unrelated HTML.
2. Add Mermaid fence tests before implementation: one success path with
   a mocked renderer that produces SVG, and one failure path that keeps a
   readable code fallback.
3. Add a Wiki E2E page fixture with a source document containing details
   plus a `mermaid` fenced block; assert literal `<details>` disappears,
   the summary can be opened, and SVG is visible.
4. Keep `markdown-it` HTML disabled. Restore only safe details/table
   blocks before Markdown rendering, and render Mermaid asynchronously
   with strict security settings.
5. Dark reader E2E should include details and Mermaid surfaces so future
   styling changes do not reintroduce near-white blocks or page-level
   horizontal overflow.

## Agent Chat Slice Example

Agent chat integration should land as separate red-green slices:

1. App shell first: assert `#chat` renders Chat, `#query` redirects to
   `#chat`, and the page no longer calls `/v1/query`.
2. Sidecar configuration next: load `.env.local`, require
   `DIKW_AGENT_API_KEY`, and assert errors do not leak secret values.
3. Session store next: create, list, reopen, rename, append, and delete
   sessions through the ADK-backed `AdkSessionStore` (ADK
   `DatabaseSessionService` persisting to `.agent-sessions/agent.sqlite`).
4. DIKW tools next: test each tool against mocked core responses,
   especially `/v1/retrieve`, base pages, page links, and wisdom.
5. HTTP protocol next: test `/agent/sessions` and streamed
   `/agent/sessions/{id}/messages` events through a real Node server.
6. Page behavior next: verify history selection, new chat, manual
   rename, streamed answer deltas, sources, tool calls, stop, and
   delete.
7. Session context next: write store/protocol tests proving sources are
   de-duplicated by page and tool events update by id; then page tests
   should verify the right rail shows the accumulated session context.
8. Layout behavior next: add a DOM/page test that `Sources` and
   `Tool calls` stay outside the conversation scroll container while the
   composer also remains outside it, then lock the same behavior with a
   Playwright smoke test.

Do not put LLM keys in browser fixtures or screenshots. Agent tests use
mocked sidecar/core behavior; real MiniMax smoke testing is manual.

## Settings, i18n, and Theme Slice Example

Shell preference work should also land vertically:

1. App shell test first: assert the default English navigation, the
   sidebar Settings entry, and the absence of Server/Token inputs in the
   top bar.
2. Settings behavior next: edit Server URL and Token in `#settings` and
   assert the existing session storage keys still drive `DikwClient`.
3. Locale behavior next: switch to `zh-CN`, assert sidebar labels and
   Settings copy change, and assert `dikw-web.locale` persists in
   `localStorage`.
4. Theme behavior next: switch Light/Dark/System, assert
   `dikw-web.theme` persists and `html[data-theme]` resolves to light or
   dark.
5. E2E smoke covers desktop and mobile overflow for primary pages plus
   Settings, and verifies the top bar remains a read-only connection
   status strip.

## i18n and Dark Reader Slice Example

Locale and theme regressions should be caught at the browser boundary:

1. Add an E2E test that visits each primary route in the default English
   locale and asserts the `page-header` region is English-only.
2. Add the matching `zh-CN` E2E path by switching language in Settings,
   then assert page headers become Chinese-only.
3. Keep the language assertion scoped to web chrome. Do not assert
   against Markdown bodies, task results, raw JSON, paths, provider
   names, or model names because those are core/user data.
4. Add a dark Wiki reader E2E test before changing styles. It should set
   `dikw-web.theme=dark`, open `#base`, compute text/background contrast
   for reader paragraphs, headings, code, tables, quotes, tabs, and
   metadata, and reject visible near-white backgrounds in `.wiki-reader`.
5. Only after those tests fail, move page chrome into `translations` and
   replace reader hard-coded colors with reader-specific CSS tokens.

## Commands

- `npm run test:watch`: local red-green loop.
- `npm test`: one-shot Vitest suite.
- `npm run test:coverage`: unit, component, hook, and page coverage with thresholds.
- `npm run test:e2e`: Playwright browser tests with mocked `/v1` API responses.
- `npm run lint`: ESLint flat config, `--max-warnings 0`; part of `verify`.
- `npm run format:check` / `npm run format`: Prettier across code (markdown excluded); part of `verify`.
- `npm run smoke:core`: contract smoke against a LIVE `dikw-core` (not in CI; needs a reachable core).
- `npm run verify`: lint, format check, typecheck, coverage, build, and E2E gate.
- `npm run check:bundle`: gzip bundle budget against `dist/` (runs in CI after the verify gate).

## Test Boundaries

- Unit tests cover deep modules such as API URL/stream handling, markdown parsing, and formatting.
- Component and hook tests use Testing Library and assert text, roles, errors, disabled states, and callbacks.
- Page tests render pages with fixture-backed fake clients. They should cover the primary user flow per page before edge cases.
- E2E tests use Playwright route mocks by default. They are a UI integration gate, not a real `dikw-core` smoke test. Specs import `test`/`expect` from `tests/e2e/harness.ts`, which fails any test that emits a `console.error` or an uncaught `pageerror` (resource-load 404s and `AbortError` are allowlisted; opt a test out with `test.use({ consoleGuard: false })`). `tests/e2e/perf.spec.ts` additionally asserts a Cumulative Layout Shift budget (≤ 0.1) per primary route; LCP and long-task totals are measured as annotations but not gated (runner-dependent timing).

## Coverage Policy

Initial thresholds are intentionally modest: statements/lines 60%, functions 55%, branches 45%. Raise thresholds only when the suite gains durable behavior coverage. Do not lower thresholds to merge a feature; add or repair tests instead.

"Do not lower thresholds" is no longer just a rule of discipline — the `gate-integrity` CI job (`npm run check:gate`, `scripts/check-gate-integrity.mjs`) enforces it mechanically. It diffs the PR against its merge base and fails if the verification itself was weakened: a lowered coverage threshold, a grown coverage `exclude` list, a raised bundle budget, raised e2e retries, a deleted/disabled test, removed assertions, or any edit to the gate/CI machinery. A deliberate, reviewed change is allowed only when a maintainer attaches the visible `gate-change` label to the PR. See `docs/adr/0005-delivery-loop-hardening.md`.

## Real Core Smoke Testing

Mocked E2E is the default gate. Manual smoke against a real local `dikw-core` remains useful before demos, but it should not block normal TDD work because local data and providers vary.

`npm run smoke:core` (`scripts/smoke-core.mjs`, driven by the `dikw-web-smoke-core` skill) automates that smoke: it asserts the consumed `/v1` contract (the `wiki → knowledge` layer value, the `/v1/tasks` envelope, `PageReadResult.frontmatter`, the graph/health/status shapes — see `docs/core-contract.md`) against a reachable core and exits non-zero on drift. Because mocked e2e can never see real contract drift, run it after a `dikw-core` version bump or before a demo. It is intentionally outside CI (needs a live core) and uses Node `fetch` (proxy-immune for localhost).
