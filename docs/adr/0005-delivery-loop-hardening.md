# 5. Delivery-loop hardening

This ADR records the decision to harden dikw-web's request→merged-PR **delivery
loop** against the failure modes of agentic, low-supervision development. It is the
umbrella record for a set of changes landing as separate PRs; this first revision
covers the **reward-hacking gate** (`gate-integrity` / `npm run check:gate`).

## Status

Accepted (2026-06-29). Living document — later sections are added as the remaining
hardening items land (trustworthy green signal, measured perf/a11y, automated
CI-watch-and-fix, loop observability).

## Context

The loop already encodes most manual + pre-merge checks as skills (the
`dikw-web-delivery-workflow`, `dikw-web-verify-frontend`, `dikw-web-smoke-core`
skills; the `docs/ui-checklist.md` + `docs/review-rubric.md` rubrics) and runs an
independent review on a different model (`/codex:review`) before merge. The CI
`verify` gate (lint / format / typecheck / coverage / build / e2e) plus
`check:bundle` is deterministic and blocks merge.

The gap is the one an autonomous agent exploits under pressure to make a check go
green: **reward hacking**. The verification's own knobs live in editable source —
coverage thresholds in `vite.config.ts`, bundle budgets in `scripts/check-bundle.mjs`,
e2e retries in `playwright.config.ts` — and a test can be deleted, `.skip`-ped, or
stripped of assertions. The only thing standing in the way was prose: "don't weaken
the tests" in `CLAUDE.md`, `docs/review-rubric.md`, and the `fixer` agent's forbidden
list. Prose is the weakest possible defense: the agent that edits the threshold also
passes the check that reads it.

## Decision

Add a deterministic gate the in-loop agent **cannot fool**:
`scripts/check-gate-integrity.mjs`, run as the PR-scoped required CI job
`gate-integrity` and mirrored locally by `npm run check:gate`.

It diffs the branch against its merge base (`<base>...HEAD`) and fails if the
verification itself was weakened:

- **coverage-threshold-lowered** — any of statements/branches/functions/lines in
  `vite.config.ts` dropped.
- **coverage-exclude-grown** — the coverage `exclude` array gained entries (drops
  files out of the denominator).
- **bundle-budget-raised** — any `*GzipKB` budget in `check-bundle.mjs` rose.
- **e2e-retries-raised** — the CI branch of `retries` in `playwright.config.ts` rose
  (a higher retry count masks new flakes).
- **test-file-deleted** / **test-skip-added** / **test-assertions-removed** — a test
  file was removed, gained a `.skip`/`.only`/`.todo`/`xit`/`xdescribe` marker, or lost
  `expect()` calls. Only *in-place* modifications are diffed; a new file is new
  coverage, and a rename-that-guts shows up as a separate delete (still caught).
- **gate-machinery-modified** — any edit to the gate script itself,
  `.github/workflows/**`, or `fixer.md`'s forbidden list. This is the **self-guard**:
  an agent cannot quietly delete a check or drop the CI job, because doing so trips the
  gate.

The "good direction" — raising a threshold, tightening a budget, adding tests — is
always allowed without ceremony. A *deliberate* weakening is allowed only when a
maintainer attaches the visible, auditable **`gate-change`** label to the PR
(`GATE_HAS_OVERRIDE=true`); the job then passes but prints what it allowed, for the
audit trail. The reviewer's remaining job is to judge whether a labelled change is
justified.

This mirrors the "a second check the agent does not control" pattern: the gate is the
mechanical backstop for the prose rule, and it guards its own machinery so it cannot
be edited away.

## Consequences

- The PR that *introduces or changes* the gate machinery (including this one) trips
  `gate-machinery-modified` by design and must carry the `gate-change` label. That is
  the intended, visible audit point, not a bug.
- The skip/assertion heuristics are deliberately dumb (regex counts), so they can have
  false positives (e.g. a test file that contains skip markers as string fixtures —
  handled by only diffing in-place modifications with a non-null base). The
  `gate-change` label is the escape hatch; the gate is a backstop, not a proof system.
- The job is PR-scoped (`if: github.event_name == 'pull_request'`) because the label
  context only exists on a PR, and a required status check already blocks every merge
  to `main`. It is therefore **not** added to `release.needs` (a skipped dependency
  would skip `release`).

## Excluded (deliberately, for "simplicity first")

The fuller autonomous-loop machinery — an on-disk `STATUS.md` + `loop_state.json`
state protocol, container `--network none` isolation, per-token cost accounting — is
out of scope. dikw-web's loop is interactive Claude Code with worktree isolation
already available for background jobs and no destructive operations; that machinery
would add complexity without proportional value here.

---

## Item 2 — trustworthy green signal (flaky e2e)

Resolved outside this effort: the flaky `graph.spec.ts > renders a nonblank Pixi graph
canvas` was root-cause-fixed in PR #140 (attach the Pixi canvas only inside the
effect's `active` guard; the spec gates on `data-render-count >= 1`). `main`
deliberately keeps `retries: 2` as a *general* backstop for timing-sensitive specs
(no longer Pixi-specific), so the gate's `e2e-retries-raised` check guards that
decision without forcing it to 1.

## Item 3 — measured perf + a11y in `verify-frontend`

The `dikw-web-verify-frontend` skill verified real-browser behavior + a clean console,
then eyeballed the `docs/ui-checklist.md` a11y/contrast/perf items. Following Delba
Oliveira's feedback-loops note ("many checks have criteria Claude can measure against:
a performance budget, an accessibility checklist"), **Step 2.5** now uses the
already-installed `chrome-devtools-mcp` against the changed route: `lighthouse_audit` for
**accessibility + best-practices** (the tool deliberately excludes performance), plus a
`performance_start_trace`/`stop_trace` for **Web Vitals**. Scored to a rubric: **a11y ≥
0.9** with no new violation (Lighthouse), **CLS ≤ 0.1** (cross-checking the
`perf.spec.ts` gate) and **LCP** as a soft budget (both from the trace). Kept a
**locally-measured** step, not a new CI gate — Lighthouse + trace timing is
runner-dependent, the same reason `perf.spec.ts` hard-gates only CLS. The `#graph` Pixi route audits a11y normally but skips the perf trace in a
background tab (stalled `requestAnimationFrame`), mirroring the skill's existing
Chrome-MCP caveat.
