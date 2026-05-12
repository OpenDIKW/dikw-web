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
expect it, while leaving Tasks, Query, Retrieve, and Graph as their own
read-only views.

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
