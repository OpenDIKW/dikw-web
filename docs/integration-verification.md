# Live integration verification

End-to-end verification of the **current dikw-web working tree** against a
**real `dikw-core`** (the published GHCR image) backed by Postgres/pgvector.
Fills the gap the rest of the test stack can't: the Playwright suite mocks `/v1`
entirely (`tests/e2e/mockApi.ts`) and `npm run smoke:core` needs a core you
brought up and seeded yourself. This harness owns the whole loop — boot core,
seed it through dikw-web's own write pipeline, then verify reads, the browser,
and the agent↔core path — in one command, reusable in CI.

It is **not** a PR gate: it boots a container and calls live LLM/embedding
providers (slow, costs tokens, depends on upstream availability). The default
`npm run verify` gate is untouched.

## What it runs

```
┌─ Docker (unique compose project: dikw-web-live[-<override>]) ─────────┐
│  pgvector/pgvector:0.8.2-pg18   (internal only — no host port)        │
│  dikw-core:${DIKW_CORE_VERSION}  host:<dynamic> → container:8765      │
│     storage=postgres, keys ← .env.core (MINIMAX / GITEE / DEEPSEEK)   │
└──────────────────────────┬───────────────────────────────────────────┘
                          │ /v1 (bearer)
┌─ host (the dikw-web working tree) ────────────────────────────────────┐
│ vite dev  host:<dynamic>  VITE_DIKW_PROXY_TARGET=<core>               │
│   • browser read-route e2e: serverUrl=default → same-origin /v1 →     │
│     Vite proxy → core  (core has no CORS, so reads must be proxied)   │
│   • agent check: Node POSTs /agent with the DEFAULT core URL (like    │
│     the browser); sidecar mirrors the proxy → core, asserts success   │
│ Node: seed-core.mts (write pipeline) + smoke-core.mjs (read contract) │
└───────────────────────────────────────────────────────────────────────┘
```

Dynamic ports + a unique compose project + project-scoped volumes mean several
core versions can run side by side with no port or volume collisions (the host
may already run other cores). The browser app sees the canonical default
`serverUrl` so it routes `/v1` through the same-origin Vite proxy; the proxy
forwards to the real (dynamically-ported) core.

## Prerequisites

- Docker running.
- `.env.core` at the repo root (copy `.env.core.example`): `MINIMAX_API_KEY` +
  `GITEE_API_KEY` required. Git-ignored.
- For the agent↔core check only: `.env.local` with `DIKW_AGENT_API_KEY` (the
  sidecar's own LLM key — the same one the chat agent uses). Missing ⇒ the agent
  check skips itself, the rest still runs.
- Playwright Chromium: `npx playwright install chromium` (once).

## Commands

| Command | Does |
| --- | --- |
| `npm run live:verify` | The whole loop: up → seed → smoke → browser e2e → agent check → down. Add `-- --keep` to leave the stack up, `-- --skip-agent` to skip the agent check. |
| `npm run live:up` | Boot Postgres + core on dynamic ports; wait healthy. Prints the core URL. Idempotent (reuses port/token). |
| `npm run live:seed` | Run the write pipeline (import → ingest → synth → lint) against the running core, reusing dikw-web's own `buildImportBundle` + `DikwClient`. |
| `npm run live:smoke` | The `/v1` read-contract smoke (`scripts/smoke-core.mjs`) against the running core. Resolves the dynamic core URL + token from the saved stack state automatically (override with `DIKW_SMOKE_CORE_URL` / `_TOKEN`). |
| `npm run live:down` | Tear down. `-- --volumes` also drops the Postgres volume + per-project state. |

Run a second core version in parallel:
`DIKW_CORE_VERSION=0.6.0 DIKW_LIVE_PROJECT=dikw-web-live-060 npm run live:up`.

## The four verification layers

1. **Write pipeline** (`scripts/seed-core.mts`) — bundles the
   `tests/fixtures/live-base/` markdown exactly as the browser does (it imports
   `src/utils/import-bundle.ts` + `src/api/client.ts` via `tsx`, so the wire
   shape can't drift from the app), then drives `/v1/import → ingest → synth →
   lint propose → lint apply`, polling each task to a terminal state. Any
   non-`succeeded` task fails the run.
2. **Read contract** (`scripts/smoke-core.mjs`) — asserts the consumed `/v1`
   shapes (health/status/info, `base/pages`, `base/graph`, `tasks` envelope)
   against the now-seeded core. See [`core-contract.md`](core-contract.md).
3. **Browser read routes** (`tests/e2e/live/`, Playwright project `live`) —
   Overview / Base / Graph / Tasks render real seeded data with a clean console
   (the harness console gate, `tests/e2e/harness.ts`, fails on any runtime
   error — the thing the mocked suite can't see). Shape-based assertions survive
   real data. The default mocked suite never runs these (`testIgnore` in
   `playwright.config.ts`).
4. **Agent↔core** (`scripts/live-core/verify-agent.mjs`) — drives one real chat
   turn through the sidecar and asserts, from the `AgentStreamEvent` tool_event
   stream (the curated tool surface the chat right-rail + `#trace` tool list
   show), that a **core-backed tool** (`retrieve_knowledge` / `read_page` / …)
   reached `status:"succeeded"` — proof the turn round-tripped to core. The turn
   sends the **default** core URL, exactly like the browser (which keeps
   `serverUrl` default and rides the same-origin proxy), so it exercises the
   sidecar's `applyDevProxyTarget` dev-proxy mirroring — sending the real core
   URL would dial core directly and mask the "fetch failed" chat bug. The
   success status matters: a `fetch failed` call still emits a tool_event, so
   asserting mere *invocation* would pass against a sidecar that never reached
   core. The in-memory trace
   waterfall (`GET /agent/sessions/{id}/traces`) is reported as a bonus when
   present, but not required: under `vite dev` ADK binds its OTel tracer at
   module load, before the sidecar registers its span processor, so the dev
   `#trace` store stays empty. The standalone sidecar (`npm start`) and any
   OTLP-exported spans are unaffected — see [`observability.md`](observability.md).

## CI

`.github/workflows/live-integration.yml` runs the same `npm run live:verify` on
`workflow_dispatch`, nightly (`schedule`), and when a PR is labeled
`live-integration`. It is **not** a required check. It needs repo secrets
`MINIMAX_API_KEY` + `GITEE_API_KEY` (and writes `.env.local` from
`MINIMAX_API_KEY` for the agent check). The harness generates the core bearer
token and Postgres password per run, so those are not secrets.

## Tracking new dikw-core versions

The verification target is **pinned** (`DIKW_CORE_VERSION`, default `0.6.5`) — by
design: a fixed version keeps the nightly reproducible, so a red run means *your*
code regressed, not that core changed under you. The pin lives in two places:
`.github/workflows/live-integration.yml` (CI/nightly) and
`scripts/live-core/harness.mjs` (local default).

`.github/workflows/bump-dikw-core.yml` keeps the pin current automatically:
weekly (and on `workflow_dispatch`) it resolves dikw-core's latest GitHub release
(`vX.Y.Z` → image tag `X.Y.Z`), and if it's newer than the pin, opens a
`chore/bump-dikw-core-<version>` PR editing both pin sites and labels it
`live-integration` so the full real-core verification runs on the PR. Upgrades
are thus explicit and reviewed (green/red signal per PR), not silent.

> **One-time setup:** the bump workflow needs a repo secret `DIKW_BUMP_TOKEN` — a
> fine-grained PAT with **contents: read/write** + **pull requests: read/write** +
> **workflows: read/write** on this repo (the bump commit edits
> `.github/workflows/live-integration.yml`, and GitHub rejects a push touching
> workflow files from a token without the workflows permission — observed in the
> 2026-06-29 scheduled run). The default `GITHUB_TOKEN` can't be used: a PR it
> opens does not trigger the required CI checks or the `labeled` event, so the
> bump PR would be unmergeable. Without the secret the workflow no-ops with a
> warning. Note the bump PR also edits a workflow file, so the `gate-integrity`
> check requires a maintainer to add the `gate-change` label before it can merge.

To bump manually instead, edit `DIKW_CORE_VERSION` in those two files (or run any
`live:*` command with `DIKW_CORE_VERSION=<x.y.z>` in the environment).

## Configuration knobs

| Env | Default | Purpose |
| --- | --- | --- |
| `DIKW_CORE_VERSION` | `0.6.5` | GHCR image tag to verify against. |
| `DIKW_CORE_LLM_MODEL` | `MiniMax-M3` | MiniMax model name in the core `dikw.yml` LLM leg. |
| `DIKW_LIVE_PROJECT` | `dikw-web-live` | Compose project name; override to run parallel stacks. |
