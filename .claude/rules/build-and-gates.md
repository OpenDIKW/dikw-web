---
paths:
  - "package.json"
  - "vite.config.ts"
  - "eslint.config.js"
  - ".npmrc"
  - "scripts/{check-bundle,check-gate-integrity,loop-log,install-scripts}*"
  - ".github/workflows/**"
---

# Commands, build, and verification gates in detail

Read this rule before you change scripts, budgets, thresholds, the build, or CI.

Dependency install scripts are off: the project `.npmrc` sets `ignore-scripts=true`, so `npm ci` / `npm install` need no python or C++ toolchain (without it, `npm ci` runs an implicit `node-gyp rebuild` for better-sqlite3, whose bundled prebuilt is what actually loads). `scripts/install-scripts.test.mjs` fails when a dependency gains an install script that hasn't been reviewed as safe to skip — review it and add it to that list, don't delete the `.npmrc`. `npm run <script>` is unaffected, but `pre*`/`post*` hooks of our own scripts won't run.
- `npm.cmd run dev` — Vite dev server, fixed at `http://127.0.0.1:4321` (`--strictPort`).
- `npm.cmd run typecheck` — `tsc --noEmit`.
- `npm.cmd run lint` — ESLint flat config (`eslint.config.js`), `--max-warnings 0`. Covers the lint layer `tsc --strict` doesn't: React hook deps/order, unused symbols (tsconfig has no `noUnusedLocals`), no raw `console` in the browser bundle. react-hooks is pinned to its two classic rules (rules-of-hooks + exhaustive-deps), **not** the v7 `recommended` preset; type-checked rules are omitted to keep it fast.
- `npm.cmd run format` / `npm.cmd run format:check` — Prettier across code (`.ts/.tsx/.js/.mjs/.css/.json`); markdown is excluded in `.prettierignore` (prose churn, no correctness value).
- `npm.cmd run test` — Vitest unit/component/server tests once.
- `npm.cmd run test:watch` — Vitest watch mode.
- `npm.cmd run test:coverage` — coverage with thresholds enforced in `vite.config.ts` (statements 60 / branches 45 / functions 55 / lines 60). Do not lower these to make a feature pass.
- `npx vitest run path/to/file.test.ts` — run a single test file. Add `-t "name"` to filter by test name.
- `npm.cmd run test:e2e` — Playwright (Chromium). The config auto-starts `npm run dev` and reuses an existing server on 4321.
- `npx playwright test tests/e2e/chat.spec.ts` — run one E2E spec.
- `npm.cmd run build` — typecheck, `vite build` (browser bundle to `dist/`), then `build:server` (esbuild bundles `server/agent/standalone.ts` to `dist-server/standalone.mjs` with `--packages=external`, since ADK + MikroORM + the native better-sqlite3 addon can't be bundled — so the sidecar imports its deps from a production `node_modules` at runtime). `npm.cmd start` runs that standalone sidecar.
- `npm.cmd run verify` — full gate: lint + format:check + typecheck + coverage + build + e2e. Run before committing behavior changes.
- `npm.cmd run check:bundle` — gzip bundle budget (entry JS / total JS / CSS) against `dist/`; runs in CI after the verify gate. Raise the budgets in `scripts/check-bundle.mjs` deliberately, like the coverage thresholds — don't bump to pass.
- `npm.cmd run check:gate` — **reward-hacking gate** (`scripts/check-gate-integrity.mjs`): diffs the branch against its merge base (`origin/main` locally; the PR base in CI) and fails if the verification *itself* was weakened — a lowered coverage threshold, a grown coverage `exclude`, a raised bundle budget, raised e2e `retries`, a deleted/disabled test or removed assertions, or any edit to the gate/CI machinery (the script, `.github/workflows/**`, `fixer.md`'s forbidden list). The good direction (raising a threshold, adding a test) is always allowed; a deliberate weakening is allowed only when a maintainer adds the visible `gate-change` label to the PR (`GATE_HAS_OVERRIDE`). Runs as the **PR-scoped required CI job `gate-integrity`** — it is the deterministic backstop for the prose "don't weaken the tests" rule in `fixer.md` / `docs/review-rubric.md`. See `docs/adr/0005-delivery-loop-hardening.md`.
- `node scripts/loop-log.mjs <event> [detail]` — append one structured JSON line to `.loop-log.jsonl` (gitignored). The delivery loop's lightweight observability: the `dikw-web-watch-ci` skill calls it at each CI-watch transition (`iter_start` / `flake_rerun` / `fixer` / `ci_fail` / `merged`) so an autonomous/background run is diagnosable after the fact. Not a CI gate. See `docs/adr/0005-delivery-loop-hardening.md`.
- `npm.cmd run smoke:core` — live-core `/v1` contract smoke (`scripts/smoke-core.mjs`, the `dikw-web-smoke-core` skill). Not a CI gate; needs a reachable core. Run after a `dikw-core` bump or before a demo.
- `npm.cmd run live:verify` — full live integration verification of the working tree against a **real `dikw-core`** (GHCR image, Postgres backend) on dynamic ports: boot → seed the write pipeline (import→ingest→synth→lint, reusing `buildImportBundle` + `DikwClient`) → read-contract smoke → browser read-route e2e (Playwright `live` project) → agent↔core check → teardown. Needs Docker + `.env.core` (LLM/embedding keys, git-ignored; copy `.env.core.example`). Not a CI gate (boots a container, calls live LLMs); `live-integration.yml` runs it on dispatch/nightly/label. Sub-commands: `live:up` / `live:seed` / `live:smoke` / `live:down` (`-- --volumes` to drop data). `-- --keep` leaves the stack up. See `docs/integration-verification.md`.
Codex-sandbox fallback when `npm.cmd run dev` fails with `Cannot read directory "../../.."`:

```powershell
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4321 --strictPort --configLoader runner
```
