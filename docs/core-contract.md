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

- `GET /v1/base/pages?active=true&layer=wiki` by default.
- `GET /v1/base/pages?active=true&layer=source` when the user selects
  the source layer.
- `GET /v1/base/pages?active=true` when the user selects all layers.
- `GET /v1/base/pages/{path}` for the selected page body.

`PageReadResult` includes `doc_id`, `path`, `layer`, `title`, `body`,
and `anchors[]`. The reader displays layer and anchor count with the
markdown body. The legacy `/v1/wiki/pages` endpoint is not used.

## Task Events

Task events are NDJSON from `GET /v1/tasks/{id}/events`.

`partial` events with `kind=file_error` are displayed as first-class
ingest file errors with `kind`, `path`, and `message`. Ingest final
results may also include `errors[]` with the same shape; the task result
summary shows a file-error count and compact list while keeping raw JSON
available in a collapsed details block.

`heartbeat` events remain transport noise and are dropped by
`DikwClient.streamNdjson`.
