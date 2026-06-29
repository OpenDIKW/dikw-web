# dikw-web Review Rubric

The project-specific lens for the **pre-merge independent review** (Delivery Loop
step 6 / `dikw-web-delivery-workflow`). Generic reviewers (`/codex:review`,
`/code-review`, CodeRabbit) catch correctness and cleanup; this rubric encodes
what's specific to *this* repo so a fresh-agent review — or a human — scores
against the same bar the maintainer would. Point the reviewer at this file.

Each item is pass/fail against the **diff under review**.

## Working principles (from CLAUDE.md)

- [ ] **Simplicity first.** Minimum code that solves the problem. No speculative
  abstractions, no single-use indirection, no unrequested configurability/flags,
  no error handling for impossible scenarios. If 200 lines could be 50, it should be.
- [ ] **Surgical.** Every changed line traces to the request. No drive-by edits to
  adjacent code/comments/formatting; matches existing style even where you'd
  differ. Pre-existing dead code is mentioned, not deleted. Only the change's own
  orphaned imports/vars are removed.
- [ ] **Goal-driven / TDD.** Behavior changes land test-first (see `docs/tdd.md`).
  Coverage thresholds in `vite.config.ts` (60/45/55/60) are **not lowered** to
  pass — tests are added/repaired instead. This is now machine-enforced by the
  `gate-integrity` CI job (`npm run check:gate`): lowering a threshold, raising a
  bundle budget, raising e2e retries, or deleting/disabling a test fails the PR
  unless a maintainer attaches the `gate-change` label. The reviewer's job here is
  to judge whether a labelled `gate-change` is actually justified.

## Repo-specific traps (these don't trip generic reviewers)

- [ ] **`server/**` relative imports carry a `.js` extension** (except `*.test.ts`).
  `moduleResolution: Bundler` won't flag a missing one; typecheck/build pass; only
  review catches it. [[project_server_js_import_extension]]
- [ ] **No UI framework.** No Tailwind/Radix/shadcn/etc.; styling stays in the
  `src/styles.css` token system + shared component classes. (The `cssGzipKB`
  bundle budget is a backstop for this.)
- [ ] **Token never exposed.** No code path renders the session token value;
  Settings keeps it a password field, the top bar shows posture only.
- [ ] **Single-language chrome.** No bilingual UI labels; core/user content is not
  translated by the web layer.
- [ ] **Sidecar secrets stay server-side.** LLM/Tavily/Jina keys never reach the
  browser, Settings, tests, or screenshots; the sidecar errors on a missing core
  URL rather than falling back to `.env.local`.

## Don't-touch list (refactors that aren't broken)

- [ ] `#chat` is the canonical chat route; `#query` redirects to it. No Query UI /
  `/v1/query` calls reintroduced.
- [ ] Connection config (serverUrl/token) is **Settings-owned**, committed on an explicit Save to `localStorage`.
- [ ] Graph exposes only `search` + `hide-orphans`; no layer-scope toggle or force
  sliders reintroduced (`docs/graph-view.md`).
- [ ] The current `src/styles.css` token system is the baseline — don't rewrite it.

## Contract & docs

- [ ] If the change touches consumed `/v1` shape, `docs/core-contract.md` and
  `scripts/smoke-core.mjs` are updated in lockstep; e2e fixtures/`mockApi.ts` match.
- [ ] Docs that drifted (`CLAUDE.md`, `README.md`, `docs/*.md`) are updated in the
  **same** change, not deferred.
- [ ] Patch intake: external patches are adapted to the current architecture, not
  blindly applied (many predate current decisions).

## Verdict

State, per finding: **accept** (fix it), **refute** (with evidence the diff is
fine), or **defer** (with an explicit rationale recorded in the PR). Correctness
issues outrank style. A clean pass is a valid result — don't invent findings.
