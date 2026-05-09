# dikw-core Contract Notes

`dikw-web` is a read-only console over the `dikw-core` `/v1` HTTP API.
This document records the web-facing subset that current tests lock.

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

## Graph View

Graph View is read-only and does not require a core graph endpoint in
v1:

- `GET /v1/base/pages?active=true` loads active page records.
- `GET /v1/base/pages/{path}` loads bodies for the selected graph layer.

The web layer parses markdown wikilinks from `body`, resolves them
against active page records, and renders only resolved internal links as
graph edges. Unresolved wikilinks are shown as counts and source-node
detail, but they do not create ghost nodes. Default graph layer is
`wiki`; `source` and `all` are client-side graph scopes.

## Task Events

Task events are NDJSON from `GET /v1/tasks/{id}/events`.

`partial` events with `kind=file_error` are displayed as first-class
ingest file errors with `kind`, `path`, and `message`. Ingest final
results may also include `errors[]` with the same shape; the task result
summary shows a file-error count and compact list while keeping raw JSON
available in a collapsed details block.

`heartbeat` events remain transport noise and are dropped by
`DikwClient.streamNdjson`.
