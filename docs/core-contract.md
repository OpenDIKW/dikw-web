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
  wisdom status buckets, assets, and the last wiki log timestamp.
- `GET /v1/info` only for auth posture.

The metric cards use `health.layer_counts` as the source of truth for
source documents, wiki pages, wisdom items, and chunks. Wisdom items do
not come from `status.documents_by_layer.wisdom`.

## Base Pages

The knowledge page uses the cross-layer page reader:

- `GET /v1/base/pages?active=true` for the base directory tree.
- `GET /v1/base/pages/{path}` for the selected page body.

`PageReadResult` includes `doc_id`, `path`, `layer`, `title`, `body`,
and `anchors[]`. The reader displays path, layer, anchor count, update
metadata, and the markdown body. The web app does not render a layer
dropdown on the knowledge page; it shows the base tree directly and
keeps wiki/source grouping visible through paths and metadata. The
legacy `/v1/wiki/pages` endpoint is not used.

The Wiki middle pane derives all reading tabs from the selected
`PageReadResult`:

- `Read` renders the markdown body as a polished, read-only article.
  Frontmatter is not shown in this tab.
- `Info` renders frontmatter, path, layer, anchor count, and update
  metadata.
- `Outline` derives headings and wikilinks from the markdown body.
- `Source` renders the raw markdown body for verification.

Markdown internal anchor links stay inside the current Wiki view. They
scroll the selected article instead of rewriting the application hash
route away from `#wiki`.

`PageReadResult.body` remains raw Markdown as returned by `dikw-core`.
Rendering Markdown pipe tables, sanitized raw HTML tables, safe details
blocks, Mermaid fenced diagrams, and KaTeX inline/block formulas is a
web-only presentation concern; it does not change the
`/v1/base/pages/{path}` response shape. The web reader does not enable
arbitrary HTML. Only the safe table/details subset documented in the UI
system is converted to live DOM; other HTML remains escaped or is
removed during table sanitization.

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

## Task Events

Task events are NDJSON from `GET /v1/tasks/{id}/events`.

`partial` events with `kind=file_error` are displayed as first-class
ingest file errors with `kind`, `path`, and `message`. Ingest final
results may also include `errors[]` with the same shape; the task result
summary shows a file-error count and compact list while keeping raw JSON
available in a collapsed details block.

`heartbeat` events remain transport noise and are dropped by
`DikwClient.streamNdjson`.
