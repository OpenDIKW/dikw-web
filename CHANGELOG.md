# Changelog

All notable changes to `dikw-web` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers are standard three-digit SemVer (`MAJOR.MINOR.PATCH`); `package.json.version`
is the single source of truth. See `[0.0.2]` below for why the four-digit `VERSION`
file format introduced in `[0.0.1.0]` was dropped.

## [Unreleased]

## [0.0.21] - 2026-06-01

### Fixed: MinerU conversion survives a request-timeout proxy (job + poll)

- **A slow MinerU conversion no longer dies behind a reverse-proxy / tunnel
  request timeout** ([#60]). The `converting` pre-stage used to run the whole
  MinerU pipeline (submit → upload → poll-until-done → download → tar+gzip)
  inside a single `POST /web/mineru/convert` request and wrote no response
  bytes until it finished, so its time-to-first-byte equalled the full
  conversion time. Behind a proxy that caps request duration (Cloudflare free
  ~100s, nginx `proxy_read_timeout` 60s) any conversion slower than that limit
  had its connection cut mid-flight — the browser saw a transport-level
  `Failed to fetch` and the job was aborted, so larger / scanned PDFs (the slow
  `vlm` path) failed while small files in the same batch succeeded.
- **`POST /web/mineru/convert` now returns `202 { jobId }` immediately and runs
  the conversion detached** in an in-memory `JobStore` (`server/web/jobStore.ts`).
  The browser polls the short `GET /web/mineru/jobs/<id>` for status and fetches
  the tar.gz from `GET /web/mineru/jobs/<id>/result` on completion, with
  `POST /web/mineru/jobs/<id>/cancel` to abort — mirroring the task model already
  used for ingest / synth / lint. Every request is now seconds-short, so none
  approaches a proxy timeout, and a failure surfaces as a structured `mineru_*`
  code (e.g. `mineru_timeout`) instead of an opaque `Failed to fetch`.
- The change is encapsulated in `convertSource` (`src/utils/mineru-convert.ts`);
  the per-file Import UI gains a `polling` substage while the detached job runs.
  `converting` stays non-resumable across a page reload (the in-memory job store
  is also dropped on a sidecar restart) — unchanged from before.

[#60]: https://github.com/OpenDIKW/dikw-web/issues/60

## [0.0.20] - 2026-05-31

### Added: configurable logo text + brand-tracking tab title

- **The sidebar logo text and browser tab title are now configurable at
  runtime.** They default to `OpenDIKW` but can be overridden — without
  rebuilding — by a `config.json` served from the static root
  (`{ "brand": { "name": { "en": …, "zh-CN": … } } }`), fetched once during
  app bootstrap. A missing or malformed file falls back to the defaults, so
  existing deployments are unaffected. `name` is per-locale and the tab
  title follows the resolved brand name; the logo image and favicon stay
  fixed. See `public/config.example.json` and the README "Branding" section.
- **The top-bar breadcrumb root is now a fixed `Workbench` / `工作台`
  label** instead of the hard-coded brand name, decoupling the
  "workbench home" crumb from branding.
- **The agent system prompt is brand-neutral** ("a helpful knowledge base
  agent") so white-labeled deployments don't surface the `OpenDIKW` name in
  chat.

## [0.0.19] - 2026-05-30

### Fixed: import survives transient gateway errors; Wisdom metric aligns

- **Import no longer aborts on a transient gateway/network blip during task
  follow** ([#56]). When `dikw-core` sits behind a reverse proxy / tunnel
  (Cloudflare, nginx, Caddy) that occasionally drops or 5xx's a long-lived
  connection, a single failed poll during a multi-minute stage (typically
  `synth` with a slow LLM) used to mark the whole import "failed" even though
  the task succeeded server-side. `DikwClient.streamTaskEvents` now silently
  reconnects on an upstream 5xx (502/503/504) or a network-level `fetch` error,
  resuming from the unchanged `from_seq` cursor with capped exponential backoff
  (1s→15s, up to 8 retries); cancellation and non-transient 4xx errors still
  propagate at once. If retries are exhausted, `ImportPage`'s `consumeTask`
  extends the existing `getTaskFinalEvent` reconciliation to a *thrown* poll, so
  a stage that finished during the outage lands `done` instead of a spurious
  failure. The same resilience benefits the Tasks and Wisdom follow paths.
- **Wisdom Overview metric is vertically aligned.** The Wisdom card had no
  caption row, so its number sat ~23px below the others in the metric strip.
  It now carries a `"wisdom items"` caption like every other card, restoring a
  shared baseline.

[#56]: https://github.com/OpenDIKW/dikw-web/issues/56

## [0.0.18] - 2026-05-30

### Changed: Import upload is file-only, with auto-filtering and shorter MinerU filenames

- **Directory upload removed.** The Import picker no longer offers a "Choose
  folder" button, and dropped folders are ignored with a hint — only individual
  files are accepted (the file input still takes multiple files at once).
- **Unsupported formats are filtered at selection.** Files whose extension can't
  be imported are dropped as soon as they're picked or dropped and reported in a
  short notice, instead of cluttering the bundle preview's skipped column (which
  now surfaces only content-level issues like empty bodies).
- **Long MinerU filenames are shortened before conversion.** MinerU errors on
  very long names, so mineru-bound files are uploaded under a ≤25-char stem
  (Unicode preserved, extension kept, bytes unchanged → dedup unaffected). The
  true original filename is forwarded via a new `originalFilename` query on
  `/web/mineru/convert` so the converted page's frontmatter `original_filename`
  stays complete.

## [0.0.17] - 2026-05-30

### Fixed: three UI / path-consistency issues

- **Sidebar Settings stays reachable.** The left sidebar is now pinned to the
  viewport (`position: sticky; height: 100vh; overflow-y: auto`) so its Settings
  footer no longer scrolls out of view when a page's main content is taller than
  the window. The mobile (≤900px) horizontal sidebar is unchanged.
- **Chat normalizes legacy `wiki/` sources.** Sessions persisted before
  dikw-core's 0.4.0 `wiki/` → `knowledge/` rename still carry `wiki/` source
  paths and a `wiki` layer; the right-rail Sources list now displays both as
  `knowledge/` / `knowledge` (paths via a new `normalizeKnowledgePath` helper)
  and dedups a page recorded under both prefixes into a single row. Live core
  already returns `knowledge/`, so new sessions are unaffected, and a frozen
  assistant message body is left untouched.
- **Tasks Op filter drops the dead `distill` hint.** The Op input placeholder no
  longer suggests `distill` (removed from core) and gains a `<datalist>` of the
  current ops — `ingest`, `synth`, `lint.propose`, `lint.apply` — so they can be
  searched/selected; free-text entry (e.g. `wisdom.write`) still works.

### Removed

- Dropped the dead `distill` maintenance action from the agent: the proposal
  tool no longer offers it and `/v1/distill` (now `404` on core, superseded by
  `/v1/lint/propose`) is no longer routed.

## [0.0.16] - 2026-05-29

### Feature: fire maintenance ops from the Tasks page toolbar

- The `#tasks` filter-bar gains **Ingest / Synth / Lint Propose / Lint Apply**
  buttons to the right of the Status / Op controls. Ingest, Synth, and Lint
  Propose start their respective core tasks with default params; **Lint Apply**
  runs against the currently-selected succeeded `lint.propose` task and applies
  **all** proposals (`pick:null`, no review gate) — it is disabled unless such a
  task is selected.
- After firing, the page refreshes the list, selects the new task, and follows
  its live event stream (reusing the existing `follow()` machinery).
- A short background poll of `/v1/tasks` (`running`, then `pending`) detects when
  core is busy — authoritatively, regardless of the active Status/Op filter — and
  disables the four fire buttons while any such task exists. The gate starts
  **closed** on mount and opens only once the first probe confirms core is idle,
  so it can't be bypassed during the initial network window. A "Task running"
  indicator marks a real reason (a detected task or an in-flight submit). The
  detail-panel **Stop** button changes from
  a client-only event-stream detach to a real `POST /v1/tasks/{id}/cancel`,
  then re-probes the gate authoritatively — the fire buttons re-enable only when
  no running/pending task remains (a queued task keeps the gate closed). Follow /
  Load events still only stream events. A running task hidden by an active
  Status/Op filter can't be selected to Stop until the filter is cleared — it
  otherwise releases the gate when it finishes on its own.
- `TasksPage` becomes a second write surface alongside `#import` (docs updated in
  `CLAUDE.md` and `docs/core-contract.md`).

## [0.0.15] - 2026-05-29

### Fix: live progress during mineru PDF / Office conversion

- **The `converting` stage no longer looks frozen.** Three issues fixed: (1) the
  `<Loader2 className="spin">` icon never animated because `.spin` had no rule in
  `styles.css` (the spin keyframe was only wired to chat-page classes); (2) the
  single `fetch` covering upload + the multi-minute mineru server conversion +
  download was labelled "uploading to mineru" the whole time, while the intended
  `polling` / "waiting on mineru" substage was never emitted; (3) no elapsed timer
  or progress bar, so a long wait showed no motion.
- `ConversionProgress` now fixes `.spin` (reuses `pr4-spin`), shows a per-row live
  elapsed timer (reuses `formatElapsed` + a 1s tick like `PipelineSteps`), shows an
  indeterminate progress bar on active rows (reuses `@keyframes import-indet`),
  relabels the in-flight wait "Converting on mineru…" with a "can take a minute or
  two" hint, respects `prefers-reduced-motion`, and styles the rows into a proper
  panel. `ConversionFileState` gains an in-memory `startedAt`. The mineru conversion
  is a black box (no progress stream), so progress is honestly indeterminate rather
  than a fake percentage.

## [0.0.14] - 2026-05-29

### Fix: import pipeline misreporting a succeeded task as failed

- **`consumeTask` now reconciles against the authoritative task row** when the
  event stream drains without a `type:"final"` event. `streamTaskEvents` stops
  polling when `task_status` goes terminal + `has_more:false`, but the import
  pipeline read *success* from a captured `final` event — two signals that can
  disagree within a single `/events` response (live `task_status` vs. a lagging
  `events[]` tail). The race surfaced as "Import failed / ingest failed" while
  the Tasks page (which reads `GET /v1/tasks/{id}`) showed the very same task
  succeeded. New `DikwClient.getTaskFinalEvent` reads that authoritative row and
  synthesizes the terminal verdict, so a succeeded ingest/synth/lint task is no
  longer misreported as a failure. Mirrors WisdomPage's existing
  drain-then-read-result pattern.

## [0.0.13] - 2026-05-29

### Adapt to dikw-core 0.4.0: K-layer `wiki` → `knowledge`

- **Contract rename across `src/types.ts` and every consumer** to match
  dikw-core 0.4.0 (`refactor!: rename K-layer "wiki" to "knowledge"`):
  `Layer` is now `"source" | "knowledge" | "wisdom"`; `InfoResponse.wiki_root`
  → `base_root`; `LayerCounts.wiki_pages` → `knowledge_pages`;
  `StorageCounts.last_wiki_log_ts` → `last_knowledge_log_ts`;
  `ApplyReport.wiki_paths_changed` → `knowledge_paths_changed`. No dual-name
  compatibility — core rebuilds on incompatibility and keeps no shims.
- **Dead fields dropped** that 0.3.0/0.4.0 stopped returning:
  `StorageCounts.wisdom_by_status` (wisdom is a first-class document layer
  now, with no candidate status) and `LlmInfo.max_tokens_query` /
  `max_tokens_distill`. Overview's stale "N candidates" detail on the Wisdom
  card is removed with it.
- **`PageReadResult.frontmatter`** (new in 0.4.0, server-parsed YAML) is
  surfaced read-only in the Base reader's Info tab, replacing the prior
  client-side body parse as the metadata source.
- **Base page now shows only `source` + `knowledge`**; wisdom is reachable
  exclusively via the dedicated `#wisdom` page.
- **The `#wiki` route is gone** — the Base page lives at `#base` (matching the
  "Base" / "知识库" label and the `/v1/base/*` endpoint family). Legacy `#wiki`
  no longer resolves and falls back to `#overview` (no redirect). The in-page
  `[[wikilink]]` syntax is unchanged.
- The sidecar agent `list_pages` tool's `layer` enum is `knowledge` (not `wiki`).

## [0.0.12] - 2026-05-28

### Wisdom: real dikw-core wiring (lists, reads, async writes, resume)

- `#wisdom` is now backed by the live core HTTP API. List comes from
  `GET /v1/base/pages?layer=wisdom&active=true` (via `useAsyncResource`),
  body + frontmatter from `GET /v1/base/pages/{path}`, backlinks from
  `GET /v1/base/pages/{path}/links?direction=in`. Saves go through the
  async `POST /v1/base/wisdom` task: the page POSTs the submit, then
  drains `client.streamTaskEvents(taskId)` until terminal and unwraps
  the `WisdomWriteReport` via `client.getTaskResult`. The mock data
  module `src/pages/__mock__/wisdom-data.ts` is deleted along with all
  of its imports.
- **Pending draft create flow**: the New dialog now constructs a
  client-only `__pending__/{slug}` draft (no path in core yet). It
  appears in the tree marked `(unsaved)`, lives in Edit mode, and the
  first Save is what POSTs to core. Empty bodies are rejected client-
  side before the request goes out (`min_length=1` is enforced by core).
- **Favorite optimistic + rollback**: ☆ flips the chip immediately and
  POSTs the full page with `no_embed=true` (core lacks a dedicated
  PATCH/status endpoint). The optimistic update rolls back if the task
  fails. `preStarStatus` is kept on a frontend `useRef` map — not
  persisted, refresh resets it (acceptable for now).
- **Resume on mount**: the in-flight write task_id is stored in
  `sessionStorage["dikw-web.wisdomWrite"]` (per-core scoped). On mount,
  if a non-terminal task is found, the page re-enters the saving state
  and continues polling. Lives in `src/state/wisdom-write.ts` next to
  the existing `import-pipeline.ts`.
- **K / D candidates for the Add wikilink / Add source picker** are
  lazy-loaded from `GET /v1/base/pages?layer=knowledge` and
  `?layer=source` when the popover opens. Client-side filter keeps the
  search-as-you-type UX; core has no search endpoint yet — that's the
  next iteration's lever if D-layer page counts get large.
- Tests: `wisdom.test.tsx` rewritten to mock `client.get / post /
  streamTaskEvents / getTaskResult`, covering 14 scenarios (list,
  detail fetch, pending draft, save round-trip, picker dedup, sources
  attach, favorite optimistic + rollback, three dirty-edit confirm
  paths, resume from sessionStorage, empty-body rejection).
  `src/test/mockClient.ts` gains a `getTaskResult` vi.fn stub.
  `tests/e2e/mockApi.ts` returns `[]` for `layer=wisdom/knowledge/source`
  so chrome e2e specs still pass.
- Out of scope (next iteration): real status dropdown (draft →
  published / archived), delete / rename / move, K/D remote search,
  Playwright spec specifically for the Wisdom write round-trip.

## [0.0.11] - 2026-05-28

### Wisdom: mock-driven page with three-pane layout, wikilink picker, inline backlinks

- `#wisdom` is now a fully interactive mock page driven by hardcoded
  fixtures in `src/pages/__mock__/wisdom-data.ts` — **no `/v1/wisdom*`
  requests at all** (the endpoint was retired). Three-pane layout:
  left directory tree (folder-first, alphabetical), middle read/edit
  tabs, right rail with Linked references + Sources (sources only
  shown in Edit; Read merges backlinks inline). Reuses the WikiPage
  `buildWikiTree` pattern and `MarkdownView` for the Read tab.
- Read tab runs `injectInlineRefs` from `src/utils/source-inline-refs.ts`
  to splice `[[title|literal]]` wikilinks into the body at first
  occurrence of any backlink title; unmatched backlinks fall into a
  bottom "Linked references" panel — same behavior as source-layer
  pages. Wikilink clicks resolve against the wisdom multimap; W→W
  resolves silently, K→K shows a 2.4s amber toast
  ("[[title]] isn't a wisdom page in this mock.") via a new
  `.wisdom-toast` block in `styles.css`.
- Edit tab toolbar: "Add wikilink" popover merges K + W candidates
  (deduped by path, per-item layer chips for k/w/d) into one picker
  matching the "Add source" chip column; cursor-position-aware
  `[[title]]` insertion. New dialog enforces kebab-case slug and
  author with `newError.author` copy; lowercased path dedup against
  existing pages.
- Lifecycle: status is `draft | published | favorite | archived` with
  a side `preStarStatus` field so toggling the star ☆ round-trips
  through `favorite` without losing the prior state (favorite → ☆
  back to `published`/`draft`/`archived`, not always `published`).
- Header layout: timestamp → ☆ favorite → status pill stacked below
  the path on the same `.reader-header--stacked` + `.reader-header__meta--inline`
  modifiers WikiPage now uses, so Base reader and Wisdom share chrome.
- Saving is a 800ms `setTimeout` that mutates the in-memory mock map
  (no API). The timer lives in a ref so navigation/create cancels
  the in-flight save instead of racing; popover closes on saving=true;
  Esc handler is one effect with priority unsaved > newDialog > popover.
- Dead-code cleanup: removed `WisdomItem`/`WisdomKind`/`WisdomStatus`
  types, the `wisdomItemsFixture` from `src/test/fixtures.ts` and
  `tests/e2e/fixtures.ts`, and the `/v1/wisdom` mock route from
  `src/App.test.tsx` and `tests/e2e/mockApi.ts`.
- Tests: 12 component tests in `src/pages/wisdom.test.tsx` covering
  tree → read → edit → save, "Add wikilink" K/W picker, "Add source"
  D picker, dirty-edit confirm + form preservation, and the
  draft → favorite → draft lifecycle round-trip. e2e:
  `i18n.spec.ts` + `navigation.spec.ts` switched to the new chrome
  (`Filter wisdom pages` label, `Starred only` chip, `exact: true`
  heading match).
- Out of scope: real `GET /v1/base/pages?layer=WISDOM` /
  `POST /v1/base/wisdom` wiring, async task polling,
  `unresolved_wikilinks` round-trip, asset upload, status mutations
  beyond ☆. Next iteration plugs the mock data source into real core
  endpoints once visual/interaction sign-off lands.

## [0.0.10] - 2026-05-28

### Chat: dedup right-rail Source list across streaming/session boundary

- `ChatPage` was concatenating `streamingSources` onto `activeSession.sources`
  without crossing the dedup boundary, so when a turn-N stream emitted a
  source already committed by an earlier turn, React rendered the same
  composite key (`${kind}-${path}-${title}`) twice and logged
  "Encountered two children with the same key". Surfaced under the
  auto-scroll stress fixture (24 sources × 2 turns → 24 duplicate-key
  warnings).
- Fix folds `streamingSources` into the session-base via `mergeSources`
  (the same `path/title/kind` dedup function used inside the streaming
  buffer), so identical sources appear once and order is preserved
  (session first, then streaming-only newcomers).
- Tool-call dedup was already safe via `mergeTools`' id-based merge — only
  sources had the cross-boundary gap.

## [0.0.9] - 2026-05-27

### Markdown reader: standard `![alt](path)` images resolve against PageAsset.assets

- Standard CommonMark `![alt](path)` syntax now routes through the same
  asset resolver as Obsidian `![[path]]` embeds. Previously only the
  Obsidian variant matched `PageAsset.original_paths`; standard
  references like `![Kitchen](./images/scenes/kitchen.png)` fell back
  to markdown-it's default renderer, which emitted a literal
  `<img src="./images/scenes/kitchen.png">` that the browser then
  tried to load from the SPA host (404). The 10 images in
  `sources/scenes.md` and similar locales-tagged corpus pages now
  load from `/v1/assets/<sha256>` 200, with token-hydration when a
  session token is configured.
- Three correctness refinements while we were in the file:
  - `alt` text passes through `self.renderInlineAsText(token.children)`
    so `![**bold** plain](x)` renders `alt="bold plain"` per CommonMark,
    not the raw source string.
  - `title` attribute is preserved across remote, plain-src, and
    token-hydrated branches (previously dropped on the two local paths).
  - Non-ASCII paths resolve correctly: markdown-it normalizeLink
    percent-encodes Unicode in standard syntax but `original_paths`
    stores raw, so the resolver tries the literal src first and falls
    back to `decodeURIComponent(src)` at the standard-image call site
    (scoped to that path only; Obsidian resolution stays verbatim).
- Behavior changes worth calling out:
  - Empty `![]()` short-circuits to nothing instead of rendering the
    default `<img src="">` — keeps drafts quiet.
  - Local refs in surfaces that don't pass `assets` (e.g. ChatPage)
    now render an explicit `.md-broken-image` placeholder where they
    previously emitted an `<img>` the browser silently 404'd; the
    explicit failure is intentional.
  - Remote URLs (`http(s)://`, `data:`) keep the `markdown-image`
    class for consistent CSS; authenticated-hydration stays inert on
    them because the selector requires `data-asset-src`.

## [0.0.8] - 2026-05-27

### Import: PDF / Office support via mineru

- ImportPage now accepts `.pdf / .doc / .docx / .ppt / .pptx / .xls /
  .xlsx` alongside the existing `.md` + assets surface. New files run
  through a `converting` pre-stage that POSTs to a new sidecar route,
  which calls mineru.net's v4 batch API and streams the converted
  markdown + assets back as a USTAR tar.gz. Once converted, files join
  the existing bundle → `/v1/import` → ingest → synth → lint pipeline
  unchanged. The `/v1/import` wire shape is unmodified, so core needs
  no changes.
- New sidecar namespace `/web/*` for dikw-web's own browser helpers,
  parallel to `/agent/*` (Pi Agent chat) and `/v1/*` (dikw-core). First
  occupants: `POST /web/mineru/convert?inputSha=<hex>` (single-file
  multipart in, tar.gz out) and `GET /web/mineru/health`. Same Node
  process as the agent sidecar — mounted in dev via `webApiPlugin()`
  in `vite.config.ts` and in prod via the same `/web` branch in
  `dist-server/standalone.mjs`. The browser only talks same-origin.
- New optional env var `MinerUAPIKey` (alias `DIKW_AGENT_MINERU_API_KEY`)
  in `.env.agent.local`. The variable name matches the
  `dikw-plugins/.env` convention so the same key file can be reused.
  Missing key → `/web/mineru/*` returns `503 mineru_disabled`,
  ImportPage shows a `Mineru not configured` notice, and the file
  picker `accept` collapses back to `.md/.pdf` (PDF still works as a
  passive asset when referenced from a sibling `.md`).
- **Idempotency** is the headline contract: same input bytes →
  identical `package_sha256`, every run. Three layers enforce this:
  (a) mineru `cache_tolerance=31536000` + `data_id=<sha256[:32]>` so
  the server-side cache returns the same conversion for one year;
  (b) browser IndexedDB cache keyed by SHA-256 of the input file
  bytes (LRU, 500 MB ceiling, `mineruVersion: 1` cache-bust knob);
  (c) byte-stable tar packaging — entries sorted, `mtime=0`,
  `uid=gid=0`, mode `0644`, frontmatter contains only
  `converter / original_filename / original_sha256` (no timestamps,
  no `batch_id`).
- New `converting` pipeline stage with a `ConversionProgress` UI surface
  (`src/pages/import/ConversionProgress.tsx`). Per-file rows surface
  substages `queued / hashing / uploading / polling / downloading /
  done / failed` with a per-file Skip on failure. Two-concurrent
  worker pool — conservative on mineru quota while still pipelining
  well. Refresh during `converting` is non-resumable in v1 — the
  pipeline returns to idle, but the mineru server cache + browser IDB
  cache make re-conversion typically millisecond-fast for the same
  input bytes. Resume during the existing core-side stages
  (`ingest / synth / lint-*`) is unchanged.
- Image references in the converted markdown are rewritten from the
  mineru `![alt](path)` form to project-conventional
  `![[assets/<rel>|alt]]` wikilinks, matching what other dikw-web
  sources do. Resolution uses a 4-tier match (exact / case-insensitive
  / basename-unique / basename-folded-unique), mirroring the
  `dikw-plugins/dikw-converter-mineru` Python implementation.
- Token redaction: the mineru bearer token never appears in error
  messages or logs in full; only `…<last 4 chars>` is ever surfaced.
- New files of interest: `server/web/{config,http,mineruClient,
  mineruConvert,vitePlugin}.ts`, `src/utils/{tar,tar-reader,
  mineru-convert}.ts`, `src/pages/import/ConversionProgress.tsx`,
  `tests/e2e/import-mineru.spec.ts`. `src/utils/tar.ts` is a new
  isomorphic extraction of the USTAR writer that was previously
  inlined in `import-bundle.ts`; the writer's behavior is unchanged,
  it is now just importable from both the browser bundler and the
  sidecar's tar.gz response builder.

### Known follow-ups

- The IndexedDB conversion cache stores `cachedAt` but does not yet
  enforce the planned 500 MB LRU ceiling — it relies on the browser's
  own quota eviction. Tracking as a follow-up so this PR stays scoped.

### Manual verification (post-merge)

End-to-end mineru verification is not part of CI because it requires a
real `MinerUAPIKey` and burns mineru quota. The e2e suite mocks the
`/web/mineru/*` wire. Before relying on the feature in a workspace:

1. Copy `MinerUAPIKey=…` from `dikw-plugins/.env` (or wherever you keep
   it) into `dikw-web/.env.agent.local`.
2. `npm.cmd run dev` and open `http://127.0.0.1:4321/#import`.
3. Drop a small PDF or `.docx`. Watch `ConversionProgress` walk through
   `hashing → uploading → polling → downloading → done`, then watch the
   regular Bundle preview render with the synthesized markdown.
4. Drop the same file again. The IDB cache should make it instant — no
   network call to `mineru.net` (verify in DevTools Network).
5. Compare `package_sha256` across two end-to-end runs of the same
   input — they must be identical for core's dedup to work.

## [0.0.7] - 2026-05-26

### Sidebar regroup + Base rename

- Split the sidebar's single flat list into three semantic clusters separated
  by hairline `border-top` dividers: `Overview / Import / Base / Graph /
  Wisdom`, then `Retrieve / Chat`, then `Tasks`. Settings stays in the footer
  group as before. The visible `KNOWLEDGE` and `SYSTEM` uppercase group labels
  are gone; each `<nav>` keeps `aria-label` for screen readers.
- Rename the en wiki-route concept from `Knowledge` to `Base` to match the
  `/v1/base/*` core endpoint family. Touches sidebar (`nav.wiki`), breadcrumb,
  wiki page heading (`pages.wiki.title`), the refresh button
  (`pages.wiki.refresh`), the Graph detail panel button
  (`pages.graph.openInWiki` → `Open in Base`), and the Graph canvas aria-label
  (`Base graph`). zh-CN keeps `知识库` / `在知识库打开` unchanged.
- zh-CN: rename `nav.wisdom` 智慧 → 认知 (English `Wisdom` unchanged) and
  cascade the wisdom page strings (`认知沉淀`, `刷新认知条目`, etc.). The
  Work nav group's zh-CN aria-label is `工作` to avoid colliding with the
  contained `任务` button.
- CSS: drop `.nav-group-label` rules; extend `.nav-main + .nav-main` to render
  the hairline divider. Mobile breakpoint (≤720px) flips the divider to
  `border-left` so the new vertical hairline doesn't appear as a stray top
  border in horizontal-scroll mode.
- Docs: `CLAUDE.md`, `README.md`, and `docs/graph-view.md` updated to the new
  Base terminology.

### Fixes

- `OverviewPage`: defensive optional chain on
  `data?.status.wisdom_by_status?.candidate`. Older / 0-wisdom core
  payloads omit the `wisdom_by_status` subkey, which previously threw
  `TypeError` and blanked the entire app via React 19's tree unmount.

## [0.0.6] - 2026-05-26

### Import page redesign

- Slim the 1018-line `ImportPage.tsx` into a 538-line orchestrator plus seven
  `src/pages/import/` subviews (`IdlePicker`, `BundlePreview`, `PipelineSteps`,
  `LintReview`, `DoneSummary`, plus `format.ts` + `readDroppedItems.ts`). All
  styling reuses the existing `src/styles.css` token system — no UI framework
  introduced.
- `IdlePicker`: dropzone now accepts both files and folders. `webkitGetAsEntry`
  walks the directory tree and injects `webkitRelativePath` so
  `computeProjectRelPath` produces the same archive paths as the folder picker.
- `BundlePreview`: two-column Included / Skipped layout with per-row type
  icons, byte sizes, and ref counts; skipped rows carry a reason tag.
- `PipelineSteps`: resumed pipelines show a blue "Resumed your import" banner
  above the stepper; a 1-second interval drives the elapsed-time text so it
  no longer freezes on silent stages. 5-step stepper renders progress bars
  and an active-stage description card.
- `DoneSummary`: large success banner with `Open in Wiki` / `View graph`
  CTAs (hash navigation), two stat cards (what was added / lint outcome),
  and a restart tail.
- Tests: `ImportPage.test.tsx` grows from 4 to 17 cases across five describe
  blocks (idle picker, pipeline resume, lint review, done summary, failure
  & cancel).

### Correctness fixes (landed alongside the redesign)

- `handlePipelineError(err, owner)` now compares the throwing controller
  against `controllerRef.current` so a late `AbortError` from a cancelled
  pipeline cannot clobber the state of a freshly-started one after the
  user clicks "Start a new import".
- `applyLint` resets `wasResumed`, breaking the
  "refresh into lint-review → click Apply → lint-apply incorrectly renders
  the resume banner" chain.
- Two hardcoded English strings now route through i18n: `stepMeta` returned
  `"5 committed"` and `BundlePreview` rendered `"refs 3"` even in the
  Chinese locale. Both have proper `en` and `zh-CN` translations now.
- Resume path seeds `pipelineStartedAt = Date.now()` so the stepper's
  elapsed segment is populated on the most important code path (mid-stage
  refresh). Combined with the 1s ticker, the clock no longer freezes when a
  task runs silent for 90+ seconds.
- `IdlePicker.onDrop` is no longer `async`. `readDroppedItems` rejections
  (permissions errors, browser quirks) now route through `onDropError`
  into the existing `bundleError` Notice instead of vanishing into the
  React synthetic-event system as unhandled promise rejections.

## [0.0.5] - 2026-05-24

### Import 页

- 新增 **Import** 路由(`#import`),sidebar 加同名入口。这是 web 第一个写入
  surface:用户在浏览器内选本地文件或文件夹,自动跑「打包 → ingest → synth
  → lint(propose + 审阅 + apply)」全管线。任意阶段可取消,任务阶段刷新可
  续轮询。core 端零改动,沿用 `/v1/import` 现有 multipart 协议。
- 浏览器侧打包(`src/utils/import-bundle.ts`):手写 USTAR tar + 原生
  `CompressionStream('gzip')` + `crypto.subtle.digest` 算 SHA-256。无新增 npm
  依赖。`package_sha256(md_sha, asset_shas) =
  sha256(sorted([md, ...assets]).join("\n").encode("ascii"))` 严格复现
  `dikw-core/src/dikw_core/md_inspect.py:60-66`。
- Markdown 引用解析(`src/utils/md-asset-refs.ts`):正则与 core 的
  `_IMG_MD` / `_IMG_WIKILINK` 一致,sibling-of-md → project-root 两段式
  解析。远程 URL 不上传,缺失 asset 在 pre-flight 阻止导入。
- 管线状态(`src/state/import-pipeline.ts`):`PipelineStage` 联合 + sessionStorage
  持久化(键 `dikw-web.importPipeline`,scope 与 `serverUrl`/`token` 一致;
  state 携带 `coreUrl` 防止跨核重放)。任务阶段(ingest/synth/lint-*)落地
  对应 `task_id`,刷新后从 `streamTaskEvents` 续跟。上传阶段单次 POST,
  刷新即丢,picker 重置。
- Lint 走法:propose 后弹审阅面板让用户勾选要 apply 的 proposal;**部分
  修复也算完成** —— 只要 task 终态 `SUCCEEDED`,即便 `ApplyReport.skipped`
  非空,管线进 done,跳过项以 reason 形式展示,不判 failure。
- `DikwClient` 扩展:`postMultipart` + `importBundle` + `startIngest` /
  `startSynth` / `startLintPropose` / `startLintApply` + `getTaskResult` +
  `cancelTask`。multipart 上传不注入 `Content-Type`,让浏览器自填 boundary。
- i18n:`nav.import` + `pages.import.*` 全量中英文案。
- 测试覆盖:`import-bundle` (Python-golden hashes、USTAR 头结构、gzip magic、
  端到端管线包)、`md-asset-refs`(19 个 case)、`import-pipeline`(状态机
  迁移 + 持久化 + cancel)、`DikwClient`(4 个新方法 wire)、`ImportPage`
  (各 stage 渲染 + cancel)、e2e(sidebar 入口 + picker 预览)。

## [0.0.4] - 2026-05-24

### Source reader

- Source 层 read tab 渲染时,把已有反向边的 K 页 title(`backlinks ∪ derived`)
  在 source body 中**首次字面出现**位置自动合成 `[[title|原文本]]` wikilink,
  阅读体验向 wiki 页对齐。未匹配上的 K 页留在底部 Linked references panel。
  Source tab(raw view)始终用原始 body,不做替换。
- 匹配规则:大小写不敏感、英文要求 `\b` 边界、CJK 无边界、最小长度英文 ≥3
  CJK ≥2、longest-match-first、保留 source 原文字面写法。
- 受保护区段不替换:YAML frontmatter / fenced & indented code(含 mermaid)/
  inline code / inline & display math / raw HTML 块(details/table/...)/
  existing wikilink(含 image embed)/ markdown link 整体。
- 实现:新增 `src/utils/source-inline-refs.ts` 纯函数(30+ 单元测试),
  WikiPage 加 `enhancedSourceBody` useMemo 串起来,MarkdownView 和
  wikilink rule 不动 — click 走现有 `previewDoc` 通道直达右侧 preview。
  零新增 CSS / 零新增 i18n key。
- `findPageForTarget` 加 K 优先(wiki/wisdom > source)— 同名 K 与 source
  共存时,合成的 inline wikilink 始终命中 K 页(否则可能 self-route 回
  当前 source)。手写 `[[xxx]]` 行为保持兼容。
- Cache-lag 防御:`injectInlineRefs` 调用前先按 `pages.data` 路径表过滤
  refs。`resolveDerivedPages` 用 wire title 占位的 K 页(还没进
  `pages.data`)不内联,留在底部 panel,由 `openBacklink` 的 path-based
  fallback 兜底 —— 否则 inline 按钮的 `openWikiLink` 会查不到 path → dead link。
- 受保护区段补全(round-2 review):
  - CRLF normalize:`injectInlineRefs` 起手把 `\r\n` 归一为 `\n`,
    frontmatter / fenced / indented / display math 这几个行向 recognizer
    才能正确识别 Windows-edited source 文件。
  - Fenced code 行扫描:替换原 regex 实现,识别 0-3 空格缩进、`backtick/tilde`
    长度 ≥3、closing fence 长度 ≥ opener、EOF unclosed fence 整段保护。
  - Markdown link 兼容:URL 允许一层 balanced parens
    (`[docs](https://example.com/path(v2))`);新增 reference-style
    (`[text][label]` / `[text][]`)和 link reference definition
    (`[label]: url`)整段保护。
- Heading slug 对齐(PR #37 /code-review finding):`slugifyHeading`
  在 lowercase 前先剥掉 `[[label|literal]]` / `[[label]]` 语法,
  这样 MarkdownView 的 `heading_open`(看 enhanced body)和
  `extractHeadingsWithSlugs`(看 original body)即使输入不同也能
  产出同一 slug。修复 source 页 outline 在"heading 含被内联的 K 页
  title"场景下 `getElementById` 命中 null → 跳转静默失败的回归。

## [0.0.3] - 2026-05-24

### Added

- Source reader merges body `[[wikilink]]` backlinks and frontmatter
  `sources:` provenance into a single `Linked references` panel with
  `linked` / `sourced` labels. Consumes `GET /v1/base/pages/{path}/provenance?direction=in`
  from `dikw-core 0.2.6+`; pre-`0.2.6` cores 404 (or 405) and the
  panel degrades silently to `/links`-only behavior. Other
  `/provenance` failures (5xx, network, parse) also clear the
  sourced channel but log a `console.warn` so the disappearance is
  debuggable. A dev-mode `console.warn` also fires when the core
  contract's layer-safety invariant is violated (non-empty
  `derived_from` on a source page).
- Source labels carry `aria-label` (`Linked via body wikilink` /
  `Linked via frontmatter source`) so screen readers announce the
  evidence channel, not just the chip text.

### Fixed

- `MarkdownView` no longer wipes mermaid SVG (or chart / hydrated image
  output) on unrelated parent re-renders. React diffs
  `dangerouslySetInnerHTML` by the wrapping object's identity, not by
  `__html` string equality, so a fresh `{ __html: html }` literal on
  every render was forcing `innerHTML` to be re-set even when the body
  HTML had not changed — discarding any post-render DOM mutations. The
  wrapper is now memoized on `html`. This was latent before but
  surfaced when the new source-reader effect started firing a second
  `setState` after page load.
- `resolveDerivedPages` no longer silently drops a `/provenance`
  entry when the cached `pages` list lags behind core — it falls back
  to the wire `title` so a just-synthesized K-page is visible in the
  source reader without a manual refresh. The click handler closes the
  loop: `openBacklink` now previews-by-path when the entry is not yet
  in `pages.data`, so the cache-lag fallback never ships a dead
  button. `previewDoc` and the new `previewByPath` share the same
  request lifecycle. The preview's `Open as main document` button is
  also hidden for cache-lag stub previews — the selection effect would
  otherwise round-trip the unknown path back to the default page,
  silently dropping the click.
- `mergeSourceReferences` is now pure-functional (no in-place
  mutation of map entries) and sorts `sourced`-only above `linked`-
  only inside the single-evidence tier so the two evidence channels
  read as contiguous visual blocks instead of interleaving by title.
- Switching between source pages clears the prior page's
  `Linked references` content synchronously, so the panel never
  shows stale chips during the body-fetch window. Existing race
  guards in the merge memo remain as defense in depth.

## [0.0.2] - 2026-05-23

### Removed

- `VERSION` file (4-digit `MAJOR.MINOR.PATCH.MICRO` from `[0.0.1.0]`). The format
  was gstack `/ship`-specific and forced `package.json.version` into non-SemVer
  territory (`0.0.1.0`), which kneecaps any tool that validates SemVer
  (`npm version <bump>`, `semver.coerce()`, future Renovate / semantic-release).

### Changed

- `package.json.version` reverted to standard 3-digit SemVer (`0.0.2`); now the
  single source of truth for the project's version. `package-lock.json` re-synced.
- `CLAUDE.md` delivery workflow step 7 reverted to `gh pr create` as the primary
  PR-creation path. `/ship` is not used in this repo — its 4-digit `VERSION`
  requirement is incompatible with valid SemVer in `package.json`, and the
  individual sub-skills it orchestrates (`/code-review`, `/review`,
  `code-simplifier` subagent) can be invoked directly when useful. Bumping
  `package.json.version` and writing the matching `CHANGELOG.md` entry are now
  manual steps in the workflow.
- `CLAUDE.md` delivery workflow step 8 rewritten to emphasize **active**
  monitoring of CI status AND PR review comments after pushing, with
  resolve-as-found discipline rather than batching at merge time. Lists the
  three `gh api` endpoints (reviews / inline comments / top-level issue
  comments) plus the `gh run view --log-failed` pattern for failing CI logs.

## [0.0.1.0] - 2026-05-23

### Added

- `CLAUDE.md` "Working principles" section (Think before coding / Simplicity first
  / Surgical changes / Goal-driven execution) anchored against the project's
  `/v1/base/graph`, `src/styles.css` token system, and `#chat` canonical route.
- `CLAUDE.md` "Delivery workflow" — 8-step end-to-end loop from request clarification
  through TDD, codex-review rounds (max 3), `/simplify` / `/code-review xhigh`, Chrome
  MCP verification, doc walk (`CLAUDE.md` + `README.md` + `docs/*.md`), PR creation,
  and squash-merge with explicit `gh api .../reviews` + `/comments` pull.
- `CLAUDE.md` "Chat / agent rules" subsection covering right-rail session-scoped
  context, core-first tool preference, and the maintenance-action confirmation gate.
- `VERSION` + `CHANGELOG.md` scaffolding so the `/ship` delivery workflow can run
  end-to-end on this repo (bump version, write changelog entry, commit, push, open
  PR) instead of falling back to `gh pr create`.

### Changed

- `package.json` `version` synced to the four-digit `VERSION` (`0.0.1.0`); the
  package is `"private": true` and not published, so the extra digit has no
  registry impact.
- `CLAUDE.md` architecture notes corrected against the actual code: Graph page
  removed `wiki` / `source` / `all` scope toggle (only `search` + `hide-orphans`
  remain), `npm.cmd run build` line updated to mention `dist-server/standalone.mjs`,
  `dist-server/` added to the local/generated list.
- `CLAUDE.md` delivery workflow step 7 dropped the "this repo doesn't carry `/ship`
  scaffolding" caveat now that `VERSION` + `CHANGELOG.md` are in place; prefers
  `/ship` over plain `gh pr create`.
- `CLAUDE.md` delivery workflow step 4 replaced the non-existent `/simplify` and
  unsupported `/code-review xhigh` argument with the actually-installed
  `/code-review` plugin (five parallel Sonnet agents with confidence scoring) and
  the `code-simplifier` subagent for cleanup passes.
- `README.md` "Where canonical docs live" entry rewritten to point at `CLAUDE.md`
  as the operational guide for Claude Code sessions, and the `npm.cmd run build`
  row in the command table updated to match `CLAUDE.md` by mentioning `build:server`
  + `dist-server/standalone.mjs` (addresses CodeRabbit feedback on PR #33).
- `README.md` "Where canonical docs live" list extended with a `docs/adr/` entry
  so future Architecture Decision Records show up in the doc index.

### Removed

- `AGENTS.md` — superseded by `CLAUDE.md` now that Claude Code is the sole
  development surface; unique guidance (sidecar `coreUrl` rejection, token-never-displayed
  rule, `.env.agent.local` containment, generated-artifact ignore list) was integrated
  into `CLAUDE.md` rather than left in a parallel file.

