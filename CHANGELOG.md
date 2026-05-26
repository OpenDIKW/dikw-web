# Changelog

All notable changes to `dikw-web` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers are standard three-digit SemVer (`MAJOR.MINOR.PATCH`); `package.json.version`
is the single source of truth. See `[0.0.2]` below for why the four-digit `VERSION`
file format introduced in `[0.0.1.0]` was dropped.

## [Unreleased]

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

