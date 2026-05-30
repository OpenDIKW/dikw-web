# dikw-core Contract Notes

`dikw-web` is a read-only console over the `dikw-core` `/v1` HTTP API.
This document records the web-facing subset that current tests lock.

`/v1/query` is no longer part of the consumed core contract. Natural
language answers are composed by the web-side Pi Agent sidecar, which
uses core retrieval/page/wisdom endpoints as tools.

## Web Settings

Settings does not add a core endpoint. It only manages browser-side
preferences and connection configuration:

- `dikw-web.serverUrl` in `sessionStorage` selects a custom core base
  URL for the current browser session. The default visible value is
  `http://127.0.0.1:8765`.
- `dikw-web.token` in `sessionStorage` stores the current session bearer
  token value.
- `dikw-web.locale` in `localStorage` selects the UI locale.
- `dikw-web.theme` in `localStorage` selects `system`, `light`, or
  `dark`.

The top bar may summarize connection target and token posture, but it
must not display the token value. When the visible server URL is the
default `http://127.0.0.1:8765`, browser `/v1` calls use the same-origin
Vite proxy to avoid CORS requirements on `dikw-core`. Custom server URLs
are requested directly. Settings changes only the client configuration
and presentation preferences.

Locale and theme are web-only presentation state. They do not change
request paths, request params, auth behavior, or the shape of any core
response. Page chrome is localized by the web app; core/user content is
rendered as returned.

## Overview

Overview reads:

- `GET /v1/health` for server identity, base root, storage engine,
  layer counts, and resolved provider metadata.
- `GET /v1/status` for detailed counters such as embeddings, links,
  assets, and the last knowledge log timestamp (`last_knowledge_log_ts`).
  dikw-core 0.4.0 no longer returns the `wisdom_by_status` buckets.
- `GET /v1/info` only for auth posture.

The metric cards use `health.layer_counts` as the source of truth for
source documents, knowledge pages (`layer_counts.knowledge_pages`),
wisdom items, and chunks. Wisdom items do not come from
`status.documents_by_layer.wisdom`.

## Base Pages

The knowledge page uses the cross-layer page reader:

- `GET /v1/base/pages?active=true` for the base directory tree.
- `GET /v1/base/pages/{path}` for the selected page body.

`PageReadResult` includes `doc_id`, `path`, `layer`, `title`, `body`,
`anchors[]`, `assets[]`, and `frontmatter` (server-parsed YAML, new in
dikw-core 0.4.0; defaults to `{}`). The reader displays path, layer,
anchor count, update metadata, and the markdown body. The web app does
not render a layer dropdown on the Base page; it shows the base tree
directly, filtered to the `source` + `knowledge` layers (wisdom has its
own `#wisdom` page), and keeps knowledge/source grouping visible through
paths and metadata. The K-layer wire value is `knowledge` (renamed from
`wiki` in 0.4.0). The legacy `/v1/wiki/pages` endpoint is not used.

`assets[]` is the deduped union of every asset referenced by any chunk
of the page. Each `PageAsset` carries `asset_id` (SHA-256 hex),
`kind`, `mime`, `bytes`, `original_paths[]` (the literal strings the
markdown used, useful for matching Obsidian `![[path]]` embeds back to
the streamable URL), `media_meta`, and `url`. `url` is always
server-relative — the wire-template is `/v1/assets/{asset_id}`. The
list is empty for text-only pages.

The Base middle pane derives all reading tabs from the selected
`PageReadResult`:

- `Read` renders the markdown body as a polished, read-only article.
  Frontmatter is not shown in this tab.
- `Info` renders the server-parsed `PageReadResult.frontmatter`
  (read-only) alongside path, layer, anchor count, and update metadata.
- `Outline` derives headings and wikilinks from the markdown body.
- `Source` renders the raw markdown body for verification.

Markdown internal anchor links stay inside the current Wiki view. They
scroll the selected article instead of rewriting the application hash
route away from `#base`.

`PageReadResult.body` remains raw Markdown as returned by `dikw-core`.
Rendering Markdown pipe tables, sanitized raw HTML tables, safe details
blocks, Mermaid fenced diagrams, KaTeX inline/block formulas, Obsidian
image embeds, and chart blocks is a web-only presentation concern; it
does not change the `/v1/base/pages/{path}` response shape. The web
reader does not enable arbitrary HTML. Only the safe table/details
subset documented in the UI system is converted to live DOM; other HTML
remains escaped or is removed during table sanitization.

## Linked references and provenance

Source-layer pages do not carry `[[wikilinks]]` of their own, so the
Wiki reader surfaces incoming references from K/W pages instead. Two
endpoints expose two independent reverse-edge channels — the reader
merges them in a single `Linked references` panel.

- `GET /v1/base/pages/{path}/links?direction=in` returns
  `PageLinksResult` whose `incoming[]` lists body `[[wikilink]]` edges
  pointing at this page (`src_doc_id`, `src_path`, `link_type`,
  `anchor`, `line`).
- `GET /v1/base/pages/{path}/provenance?direction=in` (dikw-core
  `0.2.6+`) returns `PageProvenanceResult` whose `derived_pages[]`
  lists K-pages that name this path in their frontmatter `sources:`
  list (`doc_id`, `path`, `title`). The layer-safe contract that
  core enforces: for a source page, `derived_from` is expected to be
  empty; for a knowledge page, `derived_pages` is expected to be empty.
  The reader emits a dev-mode `console.warn` if it observes a
  violation, but does not crash. Pre-`0.2.6` cores return 404 / 405
  — the reader catches these silently and degrades to `/links`-only;
  other failures (5xx, network) still clear the channel but log a
  warning so the missing data is debuggable.

`linked` (body wikilink) and `sourced` (frontmatter provenance) are
two evidence channels for the same K↔Source relationship; a given K
page can show up in either or both. The reader dedupes by `path`,
tags each entry, and lifts double-evidence references above
single-evidence ones in the panel.

### Web 渲染:source read tab 的 inline 合成

dikw-web 在 source 层 read tab 渲染时,会把 backlinks ∪ derived 合集中
**title 在 source body 首次字面出现**的位置自动合成 wikilink(参见
`docs/adr/0002-source-inline-references.md`)。匹配宽松:大小写不敏感、
英文要求 `\b`、CJK 不要求、最小长度英文 ≥3 / CJK ≥2、长 title 优先。
受保护区段(frontmatter / code / math / raw HTML / 已有 wikilink /
markdown link)不替换。未匹配 K 页留在底部 panel。Source tab 始终
显示原始 body,不做替换。本机制不改动 core 契约。

## Assets

`GET /v1/assets/{asset_id}` streams a single content-addressed asset
identified by its SHA-256 hex digest. The response carries a long
`Cache-Control: public, max-age=31536000, immutable` plus an `ETag`
matching `asset_id`, and the `Content-Type` is the asset's stored MIME.
Failure modes (unknown id, malformed id, file gone, path escapes the
asset root) collapse to a uniform `404` so the route cannot be used to
probe which ids exist.

The Wiki reader consumes this endpoint indirectly: it resolves an
Obsidian-style `![[assets/images/<sha>.jpg]]` embed against the
`PageReadResult.assets[]` entry (matching either `original_paths` or
the SHA-256 segment of the filename) and uses that entry's `url`.
Image fetches go through the Settings-owned base URL just like every
other `/v1/*` call, so the default core URL stays on the same-origin
Vite proxy and custom URLs are requested directly. When the current
Settings token is non-empty, the reader fetches asset bytes with
`Authorization: Bearer <token>` and rewrites the resulting `<img src>`
to a `URL.createObjectURL` blob URL, because the bare `<img>` element
cannot attach app-controlled headers.

## Graph View

Graph View is read-only and consumes the core graph endpoint:

- `GET /v1/base/graph?active=true` loads the full active base graph.

The response includes `base_revision`, `generated_at`, `nodes[]`,
`edges[]`, `unresolved[]`, and `stats`. Core intentionally does not
provide a `layer` query parameter in this endpoint; the web app requests
the full active graph. Graph page search and hide-orphans are
client-side presentation filters, but the page no longer exposes
`wiki`, `source`, or `all` scope toggles. Unresolved wikilinks are shown
as counts and source-node detail, but they do not create ghost nodes.

Pixi rendering, deterministic clustering, shortest-path highlighting,
and Bloom styling are web-only presentation concerns. They do not add
request parameters or change the `/v1/base/graph` response shape.

## Chat

Chat is exposed to the browser as same-origin `/agent/*` routes
owned by `dikw-web`, not by `dikw-core`. The sidecar runs Pi Agent and
uses the current Settings `Server URL` from each browser request to call
these core endpoints as tools:

- `GET /v1/health`
- `POST /v1/retrieve`
- `GET /v1/base/pages`
- `GET /v1/base/pages/{path}`
- `GET /v1/base/pages/{path}/links`
- `GET /v1/base/pages/{path}/provenance`
- `GET /v1/wisdom`

Core returns facts and evidence; the Agent composes the final answer
with its own LLM credentials. LLM keys are sidecar-only and must not be
sent to the browser, stored in Settings, or persisted in session files.
The core URL and optional core bearer token are request-scoped Agent
inputs; if `coreUrl` is missing, the sidecar rejects the request instead
of falling back to `.env.agent.local`.

The canonical browser route is `#chat`. Legacy `#query` hashes redirect
to `#chat` for compatibility only. Session titles are stored by the
sidecar and can be renamed with `PATCH /agent/sessions/{id}`; this does
not add or change any `dikw-core` endpoint.

Maintenance endpoints such as `/v1/ingest`, `/v1/synth`,
`/v1/distill`, and `/v1/lint/propose` may only be called after the
Agent creates a proposal and the user confirms it in the UI.

### Sidecar-only external tools

The Agent also exposes two sidecar-only tools that do **not** touch
`dikw-core`:

- `web_search` calls Tavily (`https://api.tavily.com/search`) and requires
  `DIKW_AGENT_TAVILY_API_KEY`. A Brave Search client is retained in
  `WebToolClient.search` for future provider rotation but is not registered
  as an agent tool.
- `web_fetch` calls Jina Reader (`https://r.jina.ai/<url>`) and requires
  `DIKW_AGENT_JINA_API_KEY`.

These tools live entirely inside the sidecar. They do not add or change
any `dikw-core` endpoint and they do not affect the core boundary above.
Their results surface to the browser as `source` events with
`kind: "web"`; the underlying API keys never leave `.env.agent.local`.

## Task list

`GET /v1/tasks` returns a `TaskListPage` envelope (not a bare array):
`{ tasks: TaskRowSummary[], next_cursor: string | null, has_more: boolean }`.

Rows are **summary** projections (`TaskRowSummary`): `task_id`, `op`,
`status`, `created_at`, `started_at`, `finished_at`, `params_digest`. They
deliberately omit `result` and `error` — the list exists to *find* tasks,
not to read their bodies. Full `result`/`error` come from
`GET /v1/tasks/{id}` (whole `TaskRow`) or `GET /v1/tasks/{id}/result`
(terminal payload). `TasksPage` therefore hydrates the detail pane by
fetching the full row (`DikwClient.getTask`) when a terminal task is
selected, and from the `final` event payload when following a live task.

Pagination is forward-only keyset: pass the prior `next_cursor` back as
`?cursor=` to fetch the next page; stop when `has_more` is `false`. The
cursor is an opaque base64url token — never parse it, just replay it
verbatim. A tampered or stale cursor surfaces as `400 invalid_cursor`;
the web layer treats that as "restart from the first page". Filters
`status` / `op` / `limit` compose with `cursor`. The web list uses a
"Load more" interaction (`DikwClient.listTasks`), not numbered paging,
because the cursor is one-directional and carries no total count.

Note: the list `cursor` and the event `from_seq`
(`GET /v1/tasks/{id}/events`) are **two distinct cursor mechanisms** —
keyset-by-`(created_at, task_id)` vs. sequence-by-`seq`. Do not
interchange them.

Beyond reading, `TasksPage` also *writes* from its toolbar: it fires
`POST /v1/ingest`, `/v1/synth`, `/v1/lint/propose`, and `/v1/lint/apply`
(the last with `pick:null` = apply-all against the selected succeeded
`lint.propose` task — no review gate, unlike the Import pipeline's
reviewed apply above). To gate against concurrent submissions it polls
`GET /v1/tasks?status=running&limit=1` (then `status=pending`) on a short
interval — authoritative regardless of the active `status`/`op` filter —
and disables the fire buttons while any such task exists. The detail-panel
Stop then cancels the *selected* task via `POST /v1/tasks/{id}/cancel`.
Because the gate ignores the filter but Stop only acts on the selected row,
a running task hidden by an active filter releases the gate only when it
finishes on its own (or after the filter is cleared so it can be selected
and Stopped).

## Task Events

Task events are NDJSON from `GET /v1/tasks/{id}/events`.

`partial` events with `kind=file_error` are displayed as first-class
ingest file errors with `kind`, `path`, and `message`. Ingest final
results may also include `errors[]` with the same shape; the task result
summary shows a file-error count and compact list while keeping raw JSON
available in a collapsed details block.

`heartbeat` events remain transport noise and are dropped by
`DikwClient.streamNdjson`.

`streamTaskEvents` decides *when to stop polling* from `task_status` +
`has_more`, but that is a distinct signal from the `type:"final"` event a
pipeline reads for its *success* verdict. Within a single `/events` response the
two can disagree — `task_status` is read live (can already be terminal) while
the `events[]` tail lags — so a page may report
`{task_status:"succeeded", has_more:false, events:[]}` and the stream ends
without ever yielding the `final` event. Consumers that gate on the verdict must
reconcile: ImportPage's `consumeTask` falls back to
`DikwClient.getTaskFinalEvent` (authoritative `GET /v1/tasks/{id}`) and
WisdomPage's `pollWriteTask` drains then reads `getTaskResult`. Both read the
same authoritative row the Tasks list shows, so a succeeded task is never
misreported as failed.

## Import

The Import page is the primary web surface that writes to `dikw-core`
(the Tasks page toolbar is the other — see "Task list" above). It
runs a four-stage pipeline rooted at `POST /v1/import`. PDF / Office
formats route through an optional `converting` pre-stage owned by the
web sidecar (`POST /web/mineru/convert` — see `docs/agent.md` for the
sidecar layout); the resulting markdown + assets are bundled exactly
like a user-authored `.md` source. The `/v1/import` wire shape is
unchanged. Same input bytes → identical `package_sha256` (mineru
`cache_tolerance` + browser IndexedDB by SHA-256 + byte-stable tar
packaging), so core's existing dedup continues to apply.

1. **Bundle**: the browser scans selected files, resolves markdown asset
   references (sibling-of-md → project-root, matching `md_inspect.py`),
   hashes each unique file (`crypto.subtle.digest('SHA-256')`), writes a
   USTAR tar, and gzips it via `CompressionStream('gzip')`. The manifest
   wire shape is `{files:[{path,size,sha256}], packages:[{id,md_path,asset_paths,package_sha256}], total_bytes}`,
   exactly the shape `dikw-core/src/dikw_core/server/routes_import.py`
   validates. `package_sha256(md, assets) =
   sha256(sorted([md, ...assets]).join("\n").encode("ascii"))` —
   divergence shows up as `manifest_package_sha256_mismatch`.
2. **Ingest** (`POST /v1/ingest`, body `{no_embed:false}`): async task.
3. **Synth** (`POST /v1/synth`, body `{force_all:false, no_embed:false}`):
   async task; only new D-layer documents are synthesised.
4. **Lint**: `POST /v1/lint/propose` then a user-driven review gate that
   selects which proposals to apply; `POST /v1/lint/apply` with the
   picked indices completes the run.

Each async task is followed via `GET /v1/tasks/{id}/events?from_seq=N&wait=30`
through `DikwClient.streamTaskEvents`. The pipeline persists active task
ids in `sessionStorage["dikw-web.importPipeline"]` (per-tab, matching the
connection-config scope of `dikw-web.serverUrl` / `dikw-web.token`) so a
refresh during any task stage resumes polling without losing state.
Persisted state carries the active `coreUrl` and is invalidated when a
mount finds a different current `client.coreId` — this prevents replaying
stale task ids against a server the user reconnected to via Settings. The
upload itself (stage `uploading`) is a single non-resumable POST —
refreshing during upload resets to the picker.

Partial lint apply (server returns SUCCEEDED with non-empty
`ApplyReport.skipped`) is treated as a normal completion. The Done card
surfaces per-proposal skip reasons but does not flag the pipeline as
failed. Only a task transitioning to `FAILED` or a network/manifest
error drops the pipeline into its `failed` branch.

The web bundler diverges from the CLI importer in two intentional spots:

- **Orphan assets**: core's `dikw client import` *rejects* a directory
  with allowed-extension assets that no markdown references. The web
  picker is more permissive (users often select a whole vault) — it
  surfaces unreferenced assets as `unreferenced_asset` skipped entries
  in the preview, leaves them out of the bundle, and proceeds. Move
  them under a referenced path if you want them committed.
- **Bundle ceiling**: core accepts up to 1 GiB
  (`DIKW_SERVER_MAX_IMPORT_BYTES`). The browser bundler ceiling is
  256 MiB because we materialize the raw tar and gzipped Blob in RAM
  before POST. Stream/spool is a follow-up.
