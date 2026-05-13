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
2. Graph builder unit test next: feed page records and markdown bodies,
   parse `[[Target]]`, `[[Target|alias]]`, and `[[Target#anchor]]`,
   dedupe repeated edges, and record unresolved wikilinks.
3. Page test then covers the API boundary: load
   `/v1/base/pages?active=true`, read page bodies, render SVG nodes and
   links, then verify search, hide-orphans, focus, and open-in-Wiki.
4. E2E mock locks the user path: navigate to `#graph`, click a node,
   inspect detail, and open it in the Wiki reader.

This keeps implementation choices, such as SVG rendering and d3-force
layout, replaceable while the visible graph behavior stays protected.

## Wiki Reader Slice Example

Wiki reader changes should land as vertical UI slices:

1. App shell first: assert removed routes, such as `#artifacts`, fall back
   to Overview and have no sidebar item.
2. Page test next: open `#wiki`, assert the default `Read` tab,
   rendered HTML body, and absence of any report-generation button.
3. Add tab behavior one slice at a time: `Info` for frontmatter and
   core metadata, `Outline` for headings and wikilinks, and `Source`
   for raw Markdown.
4. Link regression stays close to the user bug: clicking in-document
   heading links must not change the app hash away from `#wiki`, and
   wikilinks must open the right preview panel instead of navigating the
   main document.
5. E2E smoke covers the same browser path with mocked `/v1` data and
   checks desktop/mobile overflow.

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

## Pi Agent Slice Example

Agent chat integration should land as separate red-green slices:

1. App shell first: assert `#chat` renders Chat, `#query` redirects to
   `#chat`, and the page no longer calls `/v1/query`.
2. Sidecar configuration next: load `.env.agent.local`, require
   `DIKW_AGENT_API_KEY`, and assert errors do not leak secret values.
3. Session store next: create, list, reopen, rename, append, and delete
   `.agent-sessions/*.json` sessions with atomic writes.
4. DIKW tools next: test each tool against mocked core responses,
   especially `/v1/retrieve`, base pages, page links, and wisdom.
5. HTTP protocol next: test `/agent/sessions` and streamed
   `/agent/sessions/{id}/messages` events through a real Node server.
6. Page behavior next: verify history selection, new chat, manual
   rename, streamed answer deltas, sources, tool calls, stop, and
   delete.
7. Turn context next: write store/protocol tests proving messages,
   tool calls, and sources carry a shared `turnId`; then page tests
   should verify the right rail defaults to the latest assistant reply,
   switches when an older reply is selected, and does not reuse stale
   sources for source-less replies.
8. Layout behavior next: add a DOM/page test that `Sources` and
   `Tool calls` sit inside the shared conversation scroll container
   while the composer remains outside it, then lock the same behavior
   with a Playwright smoke test.

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
   `dikw-web.theme=dark`, open `#wiki`, compute text/background contrast
   for reader paragraphs, headings, code, tables, quotes, tabs, and
   metadata, and reject visible near-white backgrounds in `.wiki-reader`.
5. Only after those tests fail, move page chrome into `translations` and
   replace reader hard-coded colors with reader-specific CSS tokens.

## Commands

- `npm run test:watch`: local red-green loop.
- `npm test`: one-shot Vitest suite.
- `npm run test:coverage`: unit, component, hook, and page coverage with thresholds.
- `npm run test:e2e`: Playwright browser tests with mocked `/v1` API responses.
- `npm run verify`: typecheck, coverage, build, and E2E gate.

## Test Boundaries

- Unit tests cover deep modules such as API URL/stream handling, markdown parsing, and formatting.
- Component and hook tests use Testing Library and assert text, roles, errors, disabled states, and callbacks.
- Page tests render pages with fixture-backed fake clients. They should cover the primary user flow per page before edge cases.
- E2E tests use Playwright route mocks by default. They are a UI integration gate, not a real `dikw-core` smoke test.

## Coverage Policy

Initial thresholds are intentionally modest: statements/lines 60%, functions 55%, branches 45%. Raise thresholds only when the suite gains durable behavior coverage. Do not lower thresholds to merge a feature; add or repair tests instead.

## Real Core Smoke Testing

Mocked E2E is the default gate. Manual smoke against a real local `dikw-core` remains useful before demos, but it should not block normal TDD work because local data and providers vary.
