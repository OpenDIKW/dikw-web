# Changelog

All notable changes to `dikw-web` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers are standard three-digit SemVer (`MAJOR.MINOR.PATCH`); `package.json.version`
is the single source of truth. See `[0.0.2]` below for why the four-digit `VERSION`
file format introduced in `[0.0.1.0]` was dropped.

## [Unreleased]

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

