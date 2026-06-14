# Changelog

All notable changes to `dikw-web` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers are standard three-digit SemVer (`MAJOR.MINOR.PATCH`); `package.json.version`
is the single source of truth. See `[0.0.2]` below for why the four-digit `VERSION`
file format introduced in `[0.0.1.0]` was dropped.

## [Unreleased]

### Added

- **OpenTelemetry metrics** — Phase 3 of OTel observability. A new
  `server/shared/metrics.ts` records six instruments on the global meter:
  `http.server.request.duration` (histogram, seconds; `http.request.method` /
  `http.route` / `http.response.status_code`, recorded as each SERVER span ends),
  `dikw.job.duration` + `dikw.job.count` + `dikw.job.inflight`
  (`{dikw.job.family = mineru|translate, dikw.job.outcome = succeeded|failed}`,
  recorded at the detached conversion/translation runner boundaries — inflight is an
  UpDownCounter toggled `+1`/`-1` across the run), `dikw.llm.tokens`
  (`{gen_ai.token.type = input|output}`, from the token counts `DikwSpanProcessor`
  already parses), and `dikw.agent.turn.duration`
  (`{dikw.agent.turn.outcome = ok|aborted|error}`, around one `runMessage`). Instruments
  bind lazily on first record, so they pick up the MeterProvider ADK's
  `maybeSetOtelProviders` installs when `OTEL_EXPORTER_OTLP_ENDPOINT` (or
  `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`) is set — metrics then export over OTLP via
  ADK's `PeriodicExportingMetricReader`, alongside traces, sharing the
  `service.name=dikw-web` resource. With no endpoint env there is no MeterProvider and
  every record is a no-op (no behavior change). `@opentelemetry/sdk-metrics` is added
  for the test harness only (pinned to ADK's resolved `2.7.1`); the sidecar never
  imports an exporter. Metrics never touch `dikw-core`.
- **OpenTelemetry inbound SERVER spans** — Phase 2 of OTel observability. Every
  `/agent/*` and `/web/*` request is wrapped in a route-templated SERVER span
  (`server/shared/withServerSpan.ts`): it extracts inbound W3C trace context (so a
  browser → sidecar trace stitches through), runs the handler inside that span's
  context (the ADK invocation / future outbound spans nest under it), and ends on
  response `finish`/`close` with the `http.request.method` / `http.route` /
  `http.response.status_code` semantic-convention attributes. Session and job ids
  collapse to `:id` (and proposal ids to `:proposalId`) so span names / `http.route`
  stay low-cardinality; the raw request path is deliberately **not** exported as
  `url.path` (it would re-introduce those ids into span data — `http.route` is the
  aggregation key). SERVER spans export via OTLP (when an endpoint
  is configured) but are filtered out of the in-memory `#trace` store
  (`DikwSpanProcessor` skips `SpanKind.SERVER`; ADK agent spans are all `INTERNAL`),
  so the `#trace` waterfall is unchanged. Because the SERVER span now parents ADK's
  root `invocation` span, `SpanStore.getSessionTraces` normalizes any parent absent
  from the served view (the filtered SERVER span, or a FIFO-evicted parent) back to
  `null`, so the invocation stays a true root and the `TraceSpanView` contract holds.
  No new dependencies; no change to the `#trace` DTO or any `/agent/*` wire format.
- **OpenTelemetry trace export (opt-in)** — the first phase of OTel observability.
  Agent spans now carry a `service.name=dikw-web` resource
  (`server/agent/telemetryResource.ts`; `service.version` from `package.json`, a
  per-process `service.instance.id`, overridable via the standard `OTEL_SERVICE_NAME`).
  Setting `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) makes
  ADK additionally export these spans over OTLP to any collector/backend (Jaeger, Grafana
  Tempo, Honeycomb, …), with sampling honoring `OTEL_TRACES_SAMPLER`/`_ARG`. With no
  endpoint env the spans stay in the in-memory `#trace` store only — behavior-identical to
  before — and OTLP-exported spans inherit the same content-free redaction
  (`ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`). `@opentelemetry/resources` +
  `@opentelemetry/semantic-conventions` are promoted from already-hoisted transitive deps
  to direct deps (pinned to ADK's resolved versions; no new physical install). No change to
  the in-memory `SpanStore`, the `#trace` DTO, or any `/agent/*` wire format.
- **Automated release tags** — a `release` job in CI (`.github/workflows/ci.yml`)
  cuts a GitHub Release tagged `dikw-web-v<package.json version>` after the full CI
  gate is green on a push to `main`. It is idempotent (skips when the tag already
  exists), so only an actual `package.json.version` bump produces a new tag — which
  makes "every version update gets a tag" fall out for free; the current `0.3.0` is
  tagged on the first run. Release notes are pulled from the matching CHANGELOG
  section by `scripts/changelog-notes.mjs`. Job-scoped `contents: write` keeps the
  workflow-level read-only default everywhere else. No new dependencies.
- **Sidecar translation endpoint** (`/web/translate`, `server/web/`) — the backend half
  of Base-reader bilingual reading. A **job + poll** API (mirroring mineru, issue #60):
  `POST /web/translate/submit` (`{ blocks, targetLang }`, the document's markdown split
  into text blocks) → `202 { jobId }`, then poll `GET /web/translate/jobs/{id}` and fetch
  block-aligned `{ blocks: [{ i, tr }] }` from `…/result` (`…/cancel` aborts). The text
  blocks are translated in **ordered batches** (`splitIntoBatches`), one **streaming**
  `@anthropic-ai/sdk` call per batch over MiniMax (`messages.stream(...).finalMessage()`;
  deliberately **not** the ADK `MiniMaxLlm` adapter, which is bound to ADK's `BaseLlm`
  interface). After each batch the runner publishes `progress: { done, total, blocks }` to
  the poll status, so the browser reveals paragraphs **progressively** instead of waiting
  for the whole document; per-batch timing is logged. The model wire protocol is a
  **delimiter** — blocks joined by a distinctive sentinel line, reply split back on it —
  **not** a JSON array: arbitrary scientific Markdown (LaTeX backslash commands like
  `\circ`, unescaped quotes around code identifiers like `"scikit-learn"`, brackets)
  round-trips verbatim instead of corrupting a JSON array (both modes were live-observed
  failing the JSON protocol on a real paper). A **wrong block count** from the model is
  reconciled by splitting the batch and re-translating the halves down to singletons (not a
  re-ask — the miscount is often deterministic); two model failure modes a matching count
  hides are self-healed by `repairBlocks` (Chinese target, one re-ask per block): a block **echoed
  back untranslated** (≥ 6 English words, no CJK), or one whose translation **contains its source
  verbatim** (bilingual echo) or is **> 2× the source length** above a 60-char floor (EN→中
  compresses, so this flags hallucinated/continued content — live-observed on test2.md). The
  flagged block is re-asked alone and the re-ask **re-validated**: a result still oversized/echoed
  is rejected for the **source text** rather than injecting bloat. The system prompt also forbids
  adding/continuing/summarizing/inventing content. The SDK's own `maxRetries` is 0 so retry
  policy is single-sourced in `TranslatorClient.translate`, which retries retryable
  transport faults (429 / timeout / 5xx / connection) and an **empty reply** with
  exponential backoff + jitter; a truncated (`max_tokens`) reply and aborts are not
  retried. Wikilink
  targets are server-side **re-pinned** by order
  (`repinWikilinks`) so a translated `[[target|label]]` keeps its destination even if the
  model rewrites it. Submit enforces a 4 MB / 2000-block cap. Reuses the chat agent's
  MiniMax credentials (`DIKW_AGENT_API_KEY` / `_BASE_URL` / `_MODEL`, no dedicated key);
  only the per-call output cap `DIKW_WEB_TRANSLATOR_MAX_TOKENS` stays translator-specific;
  missing key → `503 translate_disabled` and `GET /web/translate/health` →
  `{ enabled: false }` (the reader hides its AI 翻译 entry). Browser client
  `src/utils/translate.ts` adds an IndexedDB cache (`dikw-translate-cache`, 7-day TTL
  sweep) keyed by a `TRANSLATE_VERSION` that is bumped when translation logic changes so
  stale pre-fix translations are dropped. The reader UI lands in a follow-up. No new dependencies.
- **Base reader bilingual reading** (`#base`) — the reader half of the feature above.
  English pages (detected after fetch via CJK ratio) gain an **AI translate** toggle
  fused onto the Read tab (`aria-pressed`, hairline seam) when the sidecar translator is
  configured; Chinese pages and a disabled translator show no toggle. Toggling on splits
  the body into blocks, sends the text blocks to `/web/translate`, and renders a
  paragraph-aligned **dual-column** view (`BilingualView`): source markdown left,
  Chinese right, with special blocks (code / tables / charts / `$$` math / rules / standalone
  image lines) rendered once and centered, never translated — a figure is no longer duplicated
  and alt-translated across both columns, even when a hard line break joins it to its caption
  (the MinerU figure shape). Translated paragraphs **stream in progressively** as
  the sidecar's batches land (each pair shows a skeleton only until its own translation
  arrives), rather than appearing all at once. A status bar exposes translating / cached /
  re-translate / cancel; narrow screens stack the columns. The shared markdown renderer was
  extracted from `MarkdownView` into `markdown-runtime` (mono and dual-column render through
  the exact same markdown-it instance, sanitizer, and chart / mermaid / image hydration);
  the translated column renders through a prefixed heading-slug env so its ids can't collide
  with the source column's. Clicking a wikilink in the **translated column** previews the
  target page with its title + summary translated to Chinese (`usePreviewTranslation` — two
  tiny blocks through the same `/web/translate` + IndexedDB cache — with an `AI` badge on the
  card and a silent fallback to the original on failure); a source-column or mono-view click
  previews the original, and an already-Chinese target is never re-translated. No new
  dependencies; see `docs/adr/0003-bilingual-reading.md`.
- **ESLint gate** (`npm run lint` → `eslint.config.js`, flat config, `--max-warnings 0`,
  in `verify` + CI). Covers the lint layer `tsc --strict` misses: React hook
  dependency/order rules, unused symbols (tsconfig has no `noUnusedLocals`), and no raw
  `console` in the shipped browser bundle. react-hooks is pinned to its two classic
  rules (rules-of-hooks + exhaustive-deps) rather than the v7 `recommended` preset,
  whose opinionated rules (set-state-in-effect, immutability, …) would force a
  non-surgical refactor of working code; type-checked rules are omitted to keep it
  fast. Pre-existing violations were resolved — dead types/imports removed, two useless
  assignments and an over-escaped regex fixed, and genuinely intentional hook-dep
  omissions annotated with a reason.
- **Prettier** (`npm run format` / `format:check`, in `verify` + CI) across code
  (`.ts/.tsx/.js/.mjs/.css/.json`); a one-time repo-wide reformat landed in its own
  commit (`printWidth` 100 to match the codebase). Markdown is excluded
  (`.prettierignore`) — prettier's prose pass is cosmetic churn (e.g. `*italic*` →
  `_italic_`) with no correctness value on the hand-maintained docs.
- **Layout-shift (CLS) perf budget** (`tests/e2e/perf.spec.ts`, rides `test:e2e`).
  Asserts Cumulative Layout Shift ≤ 0.1 on the primary routes (overview / base / graph
  / tasks / chat / wisdom) — the one Core Web Vital stable under headless Chromium.
  LCP and long-task totals are measured and surfaced as Playwright annotations but
  never gate (runner-dependent timing), the same reasoning that keeps `smoke:core` out
  of CI. 2026-06 baselines: CLS 0.00–0.05 across all six routes.
- **Bundle-size budget gate** (`npm run check:bundle` → `scripts/check-bundle.mjs`,
  wired into CI after the verify gate). Asserts gzipped ceilings for the entry JS
  (`index-*.js`), total JS, and CSS against `dist/`, catching the "a heavy lib
  crept into the bundle" regression class that typecheck/tests can't see. Budgets
  are inline with deliberate headroom over the 2026-06 baseline (entry 243 / total
  1695 / CSS 25 KB gzip) and raised consciously like the coverage thresholds. The
  CSS ceiling doubles as a backstop for the "no UI framework" rule. No new deps.
- **Review rubric** (`docs/review-rubric.md`) — the project-specific lens for the
  pre-merge independent review (Delivery Loop step 6): simplicity-first / surgical
  / TDD, the repo traps generic reviewers miss (`server/**` `.js` imports, no UI
  framework, token never exposed, single-language chrome), and the don't-touch
  list. Wired into `dikw-web-delivery-workflow` and `CLAUDE.md`.
- **Live-core contract smoke** (`npm run smoke:core` → `scripts/smoke-core.mjs`,
  driven by the new `dikw-web-smoke-core` skill). The e2e suite mocks `/v1`
  entirely, so it can't see real contract drift; this script asserts the consumed
  subset of `docs/core-contract.md` (the `wiki → knowledge` layer value, the
  `/v1/tasks` envelope, `PageReadResult.frontmatter`, and the health/status/graph
  shapes) against a reachable core and exits non-zero on drift. Intentionally
  outside CI (needs a live core); Node `fetch` is proxy-immune for localhost.
  Validated green against a live dikw-core 0.5.1. No new dependencies.
- **E2E console gate.** Every Playwright spec now imports `test`/`expect` from a
  new `tests/e2e/harness.ts` instead of `@playwright/test`; the harness fails any
  test that emits a `console.error` or an uncaught `pageerror`, turning "the
  console stayed clean" from a manual review step into a deterministic gate.
  Resource-load 404s (the suite intentionally 404s `config.json` and a missing
  asset) and `AbortError` are allowlisted; a test that deliberately drives an
  error path opts out with `test.use({ consoleGuard: false })`.
- **Project verification skills** (`.claude/skills/`, now tracked in git via a
  `.gitignore` exception while local settings stay ignored):
  `dikw-web-verify-frontend` encodes the per-route browser-verification pass
  (Delivery Loop step 5) with the project's hard-won gotchas (graph canvas needs
  `--headed`, not Chrome MCP; `requestIdleCallback` paths only hit the timeout in
  an MCP tab), and `dikw-web-delivery-workflow` makes the Delivery Loop an
  executable orchestration of the existing skills.
- **`docs/ui-checklist.md`** — a pass/fail rubric for the qualitative UI rules
  (single-language chrome, dark reader contrast, small radii, no UI framework,
  graph filters/legend/no-bloom, the markdown HTML allow-list), run by the
  `dikw-web-verify-frontend` skill. Test/tooling/docs only — no runtime, wire, or
  contract change, so no version bump.
- **App sidebar collapses to an icon rail** (`src/App.tsx`). A footer toggle
  (`PanelLeftClose` / `PanelLeftOpen`) shrinks the left sidebar to an icon-only
  rail; nav labels are visually hidden but kept for assistive tech (native
  tooltips restore the name on hover), and the choice persists in `localStorage`
  (`dikw-web.sidebarCollapsed`). The rail is desktop-only (gated above the 900px
  breakpoint); on narrow screens the sidebar keeps its existing behavior.
- **Base directory panel is resizable** (`#base`). The directory-tree column can
  be dragged wider/narrower via a splitter in the layout gap (pointer-capture, so
  the drag tracks past the handle) or stepped with the arrow keys on a focusable
  `role="separator"` (Home/End jump to the bounds), clamped 240–640px and
  persisted (`dikw-web.wikiSidebarWidth`), so long filenames fit. Hidden on narrow
  screens.

### Changed

- Extracted the dotenv helpers shared by both sidecar config loaders
  (`parseEnv` / `readEnvFile` / `readOptional`) into a new `server/shared/env.ts`;
  `server/agent/config.ts` and `server/web/config.ts` now import them instead of
  each carrying a byte-equivalent private copy. Behavior-neutral internal
  refactor — no env var, wire format, or `loadAgentConfig` / `loadWebConfig`
  contract changed, so no version bump.
- **Base reader "AI translate" control is now an on/off switch** (`role="switch"`
  + `aria-checked` with a sliding knob) rather than a plain `aria-pressed` button —
  a clearer affordance for the EN→中 dual-column toggle. Behavior unchanged.
- **Base reader tab rename: "Info" → "Frontmatter"** (zh-CN 信息 → 元信息), matching
  what the tab shows (`PageReadResult.frontmatter`). The en source-tab label stays
  "Source"; only the zh-CN label changed (原 "源码" → "原文").
- **Base reader raw-source panel restyled.** The source tab dropped the harsh
  black-on-white block for the reader token surface (`--reader-*`, dark-mode safe)
  and now word-wraps (`white-space: pre-wrap; overflow-wrap: break-word`), so long
  lines no longer force a horizontal scrollbar.
- **Source import now normalizes filenames and frontmatter** (`docs/adr/0004`).
  At import, every source page filename is rewritten to a Unicode-kebab name (Han
  preserved, whole name incl `.md` < 32 code points; `src/utils/kebab-source-name.ts`)
  and a flat provenance frontmatter is injected/merged — `original_filename` (the
  true name, always) plus `converter: mineru` for converted files. `title` is **not**
  injected (a body H1 stays the document title via core's resolution); no
  `original_sha256` or timestamps reach the frontmatter, so the bytes stay
  deterministic for core's `package_sha256` dedup (`normalizeForImport` +
  `src/utils/frontmatter-merge.ts`, which never clobbers author keys). The MinerU
  sidecar frontmatter changed from the nested `source: { converter, original_filename,
  original_sha256 }` block (which the reader rendered as raw JSON) to flat keys, and
  the `<stem>-<sha12>/` converted-page directory is now `<kebab-stem>/<kebab-stem>.md`.
  MinerU uploads under the kebab stem + the original extension (kept for format
  detection); two inputs whose stems kebab to the same root surface a visible
  `duplicate_path` skip, and distinct plain names that collapse to the same kebab get
  a `-2`/`-3` suffix. Removed the now-unused `src/utils/shorten-filename.ts`.

### Removed

- **Tasks toolbar "Task running" status pill.** The green-dot live indicator next
  to the maintenance buttons (Ingest / Synth / Lint Propose / Lint Apply) was
  visually abrupt and redundant — the buttons already disable while any task is
  running/pending, which is the real safety gate and is unchanged. Only the pill
  (and its now-orphaned `actions.running` copy + `.task-actions__live` style) was
  removed; the shared `.live-dot` class stays (RetrievePage still uses it).

## [0.3.0] - 2026-06-03

### Changed: rename the sidecar dotenv file and the MinerU key (BREAKING)

- **`.env.agent.local` → `.env.local`.** The file feeds both the chat agent
  (`server/agent/config.ts`) and the `/web/*` browser helpers
  (`server/web/config.ts`), so the `agent`-specific name no longer fit. Both
  loaders now read `.env.local`; `.env.agent.example` is renamed to
  `.env.example`. Rename your local file: `mv .env.agent.local .env.local`.
- **`MinerUAPIKey` (and its `DIKW_AGENT_MINERU_API_KEY` alias) → `DIKW_WEB_MINERU_API_KEY`.**
  The mineru conversion key is a `/web/*` concern, so it now follows the
  standard `DIKW_WEB_*` prefix, parallel to the `DIKW_AGENT_*` keys. This is a
  **hard rename with no backward-compatible fallback** — update the variable
  name in your `.env.local`. A missing key still degrades ImportPage to
  `.md/.pdf` only; the `503 mineru_disabled` message now names the new variable.
- `.env.example` documents `DIKW_WEB_MINERU_API_KEY` (previously the template
  never listed the mineru key at all), and `docker-compose.yml` now forwards it
  into the container alongside the optional Tavily / Jina keys, so the documented
  deployment env actually reaches `/web/mineru/*`.

## [0.2.0] - 2026-06-03

### Added: chat context-window compaction at >50% of the model window

- **Long chats now compact their history instead of growing the prompt
  unbounded.** `AdkAgentRunner` attaches ADK's built-in
  `TokenBasedContextCompactor` + `LlmSummarizer` to the `LlmAgent` (factory in
  `server/agent/contextCompactor.ts`, reusing the agent's own `MiniMaxLlm` for
  summarization). When the threshold is crossed, ADK summarizes the oldest
  events into a persisted `CompactedEvent` and `ContentRequestProcessor`
  rebuilds the prompt as `[summary, ...recent raw events]`, so the prompt
  actually shrinks; the summary persists to sqlite and carries across turns.
- **On by default, env-tunable** (`.env.agent.local`):
  `DIKW_AGENT_COMPACTION_ENABLED` (default `true`),
  `DIKW_AGENT_CONTEXT_WINDOW` (default `1048576`, the MiniMax-M3 window),
  `DIKW_AGENT_COMPACTION_RATIO` (default `0.5`), and
  `DIKW_AGENT_COMPACTION_RETENTION` (default `8`). The trigger is
  `round(contextWindow * ratio)` = 524,288 tokens at the defaults. Because
  ADK's `shouldCompact` sums per-event prompt-token counts, effective
  compaction fires somewhat before the live prompt literally reaches the ratio.
- **The summary never leaks into the chat UI.** `AdkSessionStore.projectMessages`
  filters `isCompactedEvent` so the `[Previous Context Summary]` event is not
  rendered as an assistant bubble, and `mapAdkEvent` emits no live wire event
  for it. A summarization failure is swallowed (logged) and the turn proceeds
  with the un-compacted history. See `docs/agent.md#context-compaction`.

## [0.1.1] - 2026-06-03

### Added: 7-day TTL cleanup for the browser MinerU convert cache

- **The IndexedDB convert cache (`dikw-mineru-cache`) now prunes entries older
  than 7 days.** Each cached conversion already recorded a `cachedAt`; on every
  ImportPage mount, `IDBConvertCache.sweepExpired` (`src/utils/mineru-convert.ts`)
  walks the store with a readwrite cursor and deletes any entry whose `cachedAt`
  is more than `CACHE_TTL_MS` (7 days) old, plus legacy/corrupt rows with a
  missing or non-finite `cachedAt`. The TTL is **absolute** — a cache hit does
  not refresh `cachedAt`. The sweep is deferred to `requestIdleCallback` (with a
  `setTimeout` fallback) so its readwrite transaction never queues ahead of the
  import flow's foreground cache reads, and runs only at the single point the
  cache is opened, so no ImportPage / wire-format changes were needed.

## [0.1.0] - 2026-06-03

### Changed: chat agent runtime migrated from Pi Agent to Google ADK

- **The chat sidecar's agent runtime moved from `@earendil-works/pi-agent-core` /
  `@earendil-works/pi-ai` to Google ADK (`@google/adk`).** The same-origin
  `/agent/*` HTTP API and the `AgentStreamEvent` NDJSON wire format are
  **unchanged**, so the browser / chat UI is unaffected. `AdkAgentRunner`
  (`server/agent/adkRunner.ts`) drives one turn on ADK's `Runner` and maps each
  ADK `Event` → `AgentStreamEvent` (`mapAdkEvent`); the DIKW tool set is now ADK
  `FunctionTool`s (`server/agent/adkTools.ts`) reusing the existing core / web
  tool clients.
- **The LLM is MiniMax via its Anthropic-compatible endpoint through a custom
  `MiniMaxLlm extends BaseLlm` adapter** (`server/agent/minimaxLlm.ts`, using
  `@anthropic-ai/sdk` as transport), and the model is upgraded
  `MiniMax-M2.7` → **`MiniMax-M3`** (`.env.agent.example`). MiniMax `thinking`
  content blocks are dropped — only `text` / `tool_use` cross the boundary.
- **Sessions now persist to local SQLite** (`.agent-sessions/agent.sqlite`,
  appName `dikw-web`, userId `demo`) via ADK's `DatabaseSessionService` instead
  of one JSON file per session. `AdkSessionStore` (`server/agent/adkSessionStore.ts`)
  projects ADK events into the existing `AgentSession` DTO at read time, mirroring
  title / createdAt / message-count / proposal-status into `session.state`.
  **Old `.agent-sessions/*.json` files are not migrated** (local demo data; expect
  a one-time reset).

### Added: hidden `#trace` page (OpenTelemetry span waterfall)

- **New hidden route `#trace`** (`src/pages/TracePage.tsx`) — reachable by URL
  only, intentionally absent from the sidebar nav (`hiddenViewIds` in
  `src/App.tsx`). It shows a per-session conversation alongside an
  OpenTelemetry span waterfall served at `GET /agent/sessions/{id}/traces`.
- **Spans are captured by a custom `DikwSpanProcessor`** (registered once per
  process via ADK's `maybeSetOtelProviders`) into an in-memory, bounded
  `SpanStore` (`server/agent/spanStore.ts`), which re-assembles flat span rows
  into the per-session `SessionTraceView`. Spans are **ephemeral** — lost on a
  sidecar restart by design; only the conversation content is persisted (sqlite).

### Changed: Docker runtime ships a production `node_modules`

- **`build:server` now bundles with esbuild `--packages=external`** — ADK +
  MikroORM + native sqlite3 can't be bundled (dynamic driver `import()` + native
  addons), so `dist-server/standalone.mjs` imports its dependencies from
  `node_modules` at runtime.
- **The Docker image is rebuilt around `node:24-slim`** (Debian glibc, for
  reliable sqlite3 N-API prebuilts) with a dedicated `prod-deps` stage
  (`npm ci --omit=dev`) whose pruned `node_modules` ships into the runtime image
  alongside `package.json`. The `HEALTHCHECK` probes via `node -e fetch(...)`
  since `node:24-slim` ships neither `wget` nor `curl`.
- **`package.json` gained `overrides`** (`node-gyp`, `tar`) to clear HIGH
  npm-audit CVEs and an explicit `undici` dependency.

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
  the tar.gz from `GET /web/mineru/jobs/<id>/result` on completion (served
  idempotently within the job's TTL, so a transfer cut mid-flight by a flaky
  proxy is retry-safe rather than a lost conversion), with
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

