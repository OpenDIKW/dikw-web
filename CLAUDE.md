# CLAUDE.md

Guidance for Claude Code in the `dikw-web` repository.

React/Vite management workbench over `dikw-core`. The browser consumes HTTP `/v1`, predominantly reads plus explicit Import, Wisdom and maintenance writes. The private `dikw-mbweb` repository owns the paper business application; a sibling checkout is not a browser data source.

Product and contract docs are in `docs/` (`core-contract.md`, `graph-view.md`, `ui-system.md`, `agent.md`, `tdd.md`, `observability.md`, `integration-verification.md`, `shared-packages.md`). Read the relevant ones before non-trivial work.

## Commands

On Windows, use `npm.cmd` (not `npm`) from PowerShell.

- `npm ci` needs no python or C++ toolchain, because `.npmrc` sets `ignore-scripts=true`. Do not delete `.npmrc`.
- `npm.cmd run dev` — Vite dev server, fixed at `http://127.0.0.1:4321` (`--strictPort`).
- `npm.cmd run typecheck` — `tsc --noEmit`.
- `npm.cmd run lint` — ESLint, `--max-warnings 0`.
- `npm.cmd run format` / `npm.cmd run format:check` — Prettier, code only (Markdown is excluded).
- `npm.cmd run test` — Vitest once. `npx vitest run path/to/file.test.ts` runs one file; add `-t "name"` to filter.
- `npm.cmd run build:packages` — build the shared packages. Run it after you change package source and before a direct Vitest run.
- `npm.cmd run test:coverage` — coverage with the thresholds in `vite.config.ts` (60 / 45 / 55 / 60). Do not lower them.
- `npm.cmd run test:e2e` — Playwright. `npx playwright test tests/e2e/chat.spec.ts` runs one spec.
- `npm.cmd run build` — browser bundle to `dist/`, sidecar to `dist-server/standalone.mjs`. `npm.cmd start` runs the sidecar.
- `npm.cmd run verify` — full gate: lint + format:check + typecheck + coverage + build + e2e. Run it before you commit a behavior change.
- `npm.cmd run check:bundle` — gzip bundle budget. Do not raise a budget to make a change pass.
- `npm.cmd run check:gate` — reward-hacking gate. It fails when the branch weakens verification: a lower threshold, a larger budget, more e2e retries, a deleted or skipped test, removed assertions, or an edit to the gate machinery. Only a maintainer's `gate-change` label allows a deliberate weakening.
- `node scripts/loop-log.mjs <event> [detail]` — append one line to `.loop-log.jsonl` (the delivery-loop log).
- `npm.cmd run smoke:core` — live-core `/v1` contract smoke. Not a CI gate.
- `npm.cmd run live:verify` — full live integration against a real `dikw-core` (needs Docker and `.env.core`). Not a CI gate.

Full detail, sub-commands, and the Codex-sandbox fallback for `dev`: `.claude/rules/build-and-gates.md`.

## Architecture

- **npm workspace.** Shared browser protocols, sidecar runtime, and UI live in `packages/web-client`, `packages/web-server`, `packages/web-ui` (MIT). Consume them through `@opendikw/web-*` subpath exports. Do not import package source paths or restore copies under `src`.
- **Browser app** (`src/`): React 19 + TypeScript. No UI framework. Styling is the hand-rolled token system in `src/styles.css`.
- **Sidecar** (`packages/web-server`): same-origin Node middleware, in the Vite dev server and in `dist-server/standalone.mjs`.
  - `/agent/*` runs the chat agent (Google ADK, MiniMax through the Anthropic-compatible endpoint). It calls the core.
  - `/web/*` hosts browser helpers: MinerU conversion and translation, as job + poll APIs. It never calls the core.
- **Core URL:** the sidecar must fail on a missing core URL. It must never fall back to `.env.local`.
- **WARNING:** `.env.local` holds local LLM credentials. Never expose it to the browser, tests, or screenshots.
- **Auth mode:** `DIKW_WEB_AUTH_MODE=oidc` turns the standalone server into an OIDC Backend-for-Frontend. It is off by default, and `npm run dev` never authenticates. Keep every new route behind the gate.
- **Local, not source:** `.agent-sessions/`, `.tmp/`, `coverage/`, `dist/`, `dist-server/`, `test-results/`, `playwright-report/`. Do not commit them.

## Area rules

The full detail for each area is in `.claude/rules/`. A rule loads when you read or edit a file in its area.
Before you design a change in an area, read its rule file.

- `agent-sidecar.md` — sidecar runtime, ADK agent, sessions, OTel spans / metrics / logs, chat rules, context compaction.
- `web-jobs.md` — MinerU and translation job + poll APIs, the job store, translation batching and repair.
- `core-connection.md` — default core URL, the Vite proxy, the dev-proxy injection, connection storage.
- `auth.md` — OIDC BFF, sessions, roles, the request router, viewer/editor capabilities.
- `routes.md` — hash routes and the core endpoints each page reads.
- `import-pipeline.md` — `#import`: bundling, MinerU conversion, name normalization, preflight.
- `markdown-reader.md` — Markdown rendering, images, charts, source inline references.
- `branding-telemetry.md` — `public/config.json`, branding, browser RUM.
- `mb-migration.md` — the legacy MB notice and its backup export.
- `testing.md` — test layers, the e2e console gate, live verification.
- `shared-packages.md` — package versions, publish, and registry verification.
- `build-and-gates.md` — every command in detail, budgets, thresholds, the reward-hacking gate.

## Hard rules

- `#chat` is the canonical chat route. `#query` must redirect to `#chat`. Do not reintroduce a Query UI or `/v1/query` calls.
- Graph exposes only the `search` and `hide-orphans` filters. Do not reintroduce the scope toggle or browser-side body reads that build edges.
- Base reads `/v1/base/pages*`. Do not use the legacy `/v1/wiki/pages` endpoint. The K-layer wire value is `knowledge`.
- The top bar may show the connection target and token posture. It must never display the token value.
- The agent must propose a maintenance action (a destructive core operation), and the user must confirm it. Never auto-execute one.
- The `/agent/*` HTTP API and the `AgentStreamEvent` NDJSON wire shape are frozen.
- Chat right-rail context is session-scoped. Do not "fix" it by filtering per turn.
- Sidecar logging goes through `createLogger(scope)`. Never use raw `console.*` in the sidecar.

### UI rules

- Compact knowledge-workbench feel: warm neutral surfaces, petrol accent, hairline borders, restrained shadows, small radii.
- Page chrome is single-language per current locale — no bilingual labels like `Overview / 工作台概览`. Core/user content is not translated by the web layer.
- Dark-mode Wiki reader uses reader tokens — avoid large near-white blocks.
- Don't add a UI framework (shadcn / Radix / Tailwind / etc.) without an explicit plan — work within the `src/styles.css` token system.

## Working rules

### Clarify before coding

- State your assumptions.
- When a root cause depends on data shape, check it against the live API (`/v1/health`, `/v1/base/graph`, `/v1/base/pages/{path}/links`) before you design around it. A plausible cause is not a confirmed one.
- If a request has more than one reading, show them. Do not pick one silently.
- If a decision blocks you, ask one question with the AskUserQuestion tool. Put your recommended answer first.
- If a simpler approach exists, say so. Push back when it is warranted.

### Keep the change small

- Write the minimum code that solves the request. No features beyond it, no single-use abstractions, no flexibility that nobody asked for, no error handling for impossible cases.
- If 200 lines could be 50, rewrite it.
- Do not "improve" adjacent code, comments, or formatting. Match the existing style.
- Do not refactor what works: the `#chat` canonical route, Settings-owned connection config, the current `styles.css` tokens.
- Report unrelated dead code. Do not delete it.
- Remove the imports, variables, and functions that your change made unused. Leave dead code that was already there.
- Every changed line traces to the request.

### Test first, then loop until verified

- TDD is the default (`docs/tdd.md`): failing test first → smallest change to green → refactor.
- Turn the request into a check: "add validation" → tests for invalid inputs; "fix the bug" → a failing test that reproduces it; "refactor X" → tests pass before and after.
- Each step is a loop: **write → run the checks → read the error → fix the cause → run again**. Use `npx vitest run …` and `npm.cmd run typecheck`. `npm.cmd run verify` is the final gate for a behavior change.
- For multi-step work, give each step a check: `npx vitest run …`, `npm.cmd run typecheck`, a `curl` against `/v1/...`, or a browser screenshot.
- Stop the loop when one of these happens:
  - **Green** — report done. Quote the passing output from *this* session, never a remembered or earlier run.
  - **5 attempts spent** — stop. Report what still fails and what you tried.
  - **Same error twice in a row** — stop. You are guessing. Diagnose the root cause again, or hand off to the `fixer` agent (`.claude/agents/fixer.md`).
- **Fix the code, not the test.** Do not weaken an assertion. Do not lower the coverage thresholds in `vite.config.ts`.

### Language

- Write plans and reports in the user's language (Chinese or English).
- Keep code, identifiers, file paths, and commands in English. Markdown files in the repo are English.

## Autonomy

- When a step does not need my input, continue. Put status notes in the same message as your next action.
- The delivery loop is approval to commit, push, open the PR, merge it when it is green and reviewed, and delete the merged branch. (The merge still goes through the permission prompt.)
- Stop and ask only when one of these is true:
  - You cannot continue without my decision.
  - A block signal from the `dikw-web-delivery-workflow` skill fires.
  - The next action is destructive and not approved above: delete data or files you did not create, or change anything outside this repository.
- Do not end a turn in these ways while work is still owed:
  1. A summary that announces the next step but does not take it.
  2. An offer to continue "unless you prefer otherwise".
  3. A list of decisions that do not block the remaining work.
  4. A pause only because the turn was long or a milestone is done.
- **WARNING:** Never force-push, and never route around `check:gate`.

## Finish line

A behavior change is done when all of these are true:

- The PR is squash-merged with an explicit `gh pr merge <N> --squash --delete-branch` (never `--auto`). Local `main` is synced.
- Every CI check is green. Every actionable review comment is fixed, refuted with evidence, or deferred with a reason in the PR body.
- `.loop-log.jsonl` has a `merged` line for the PR.

If you cannot reach this, stop on a block signal and report it.

## Report

End every run with these three headings:

- **需要你决定** — decisions or approvals you wait for. Write "无" if there are none.
- **改动** — what changed, with PR links.
- **发现** — what you found. Mark each claim you could not confirm, and say where you looked.

For an architecture or flow explanation, use a Mermaid diagram or an HTML page when it is clearer than prose.

## Delivery loop

- For any behavior change, run the `dikw-web-delivery-workflow` skill. It is the only definition of the steps, the review tiers, and the block signals.
- For a trivial edit (typo, comment, single-line refactor), skip the loop.

## Testing

- Write page and component tests for visible behavior. Write API-boundary tests for client and sidecar contracts.
- Every e2e spec imports `test` / `expect` from `tests/e2e/harness.ts`, not from `@playwright/test`. The harness fails a test on any `console.error` or uncaught `pageerror`.
- The e2e suite mocks `/v1`, so it cannot see contract drift. Use `smoke:core` or `live:verify` for that.
- Detail: `.claude/rules/testing.md`.

## Patch intake

Don't blindly overwrite app files from external patches. Many older patches predate current decisions (`#chat` canonical route, Settings-owned connection config, the current `styles.css` token system). Adapt the useful parts into the current architecture and update tests/docs to match.
