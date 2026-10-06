---
name: dikw-web-smoke-core
description: Smoke-test dikw-web's consumed /v1 contract against a LIVE dikw-core. Use when a real core is reachable and you need to confirm the contract hasn't drifted — before a demo, after a dikw-core version bump, or whenever a change touches the shape of core data the app reads. Fills the gap that the e2e suite (which mocks /v1 entirely) cannot cover.
---

# Smoke-test the live core contract (dikw-web)

The Playwright e2e suite mocks `/v1` end to end (`tests/e2e/mockApi.ts`). So it **cannot** catch real contract drift.
Examples it would miss: the 0.4.0 `wiki → knowledge` layer rename, `/v1/tasks` becoming an envelope, a dropped `frontmatter` field.
All of these pass mocked e2e and break against a real core. This skill closes that gap.

It is **not** a CI gate, because it needs a running core and live data. Run it at the moments below.

## When to run

- **After a dikw-core version bump** — the moment with the highest value.
- **Before a demo** against a real core.
- **When a change touches the shape of consumed core data** — step 3 of `dikw-web-verify-frontend`.

## How to run

```bash
# default core at http://127.0.0.1:8765
npm.cmd run smoke:core
# or an explicit URL / remote core
node scripts/smoke-core.mjs http://host:port
```

- Optional env: `DIKW_SMOKE_CORE_URL` (base URL) and `DIKW_SMOKE_CORE_TOKEN` (bearer).
- Node's global `fetch` ignores `HTTP_PROXY`, so localhost needs no `--noproxy` (unlike `curl` here).

Exit codes: `0` all checks pass · `1` a contract check failed (drift) · `2` core unreachable · `3` script crash.

## What it asserts (the consumed subset of docs/core-contract.md)

`scripts/smoke-core.mjs` checks, against the live core:

- `GET /v1/health` — `layer_counts.{sources,knowledge_pages,wisdom_items,chunks}` + `providers`.
- `GET /v1/status` — `documents_by_layer`, `chunks`, `embeddings`, `links`.
- `GET /v1/info` — `auth_required`.
- `GET /v1/base/pages?active=true` — every `layer ∈ {source,knowledge,wisdom}`, and **no legacy `wiki`** (the app filters Base to `layer === "knowledge"`).
- `GET /v1/base/pages/{path}` — `PageReadResult` carries `doc_id/path/layer/title/body/anchors/assets/frontmatter` (path encoded like `WikiPage.encodePath`).
- `GET /v1/base/graph?active=true` — `base_revision/nodes/edges/unresolved/stats`.
- `GET /v1/tasks` — the `{tasks,next_cursor,has_more}` envelope, not a bare array.

## On failure

A failed check means the live core differs from what dikw-web consumes. Decide which side is right:

- **The core changed on purpose** (for example a new rename): update the consuming page, `docs/core-contract.md`, and the e2e fixtures / `mockApi.ts` to match. Then extend this script's assertion. Land it as a vertical slice (see `docs/tdd.md`).
- **The core regressed:** file it upstream. Do not hide it in the web layer.

Keep the script's assertions in step with `docs/core-contract.md`. When you add a consumed endpoint or field there, add a check here.
