---
name: dikw-web-delivery-workflow
description: The end-to-end dikw-web delivery loop, from request to merged PR. Use for any behavior change in this repo (feature, fix, refactor that changes behavior). Orchestrates the existing skills/commands in order so the loop runs consistently instead of being re-derived from CLAUDE.md prose each time. Skip only for trivial edits (typo, comment, one-line refactor).
---

# dikw-web delivery workflow

This is the executable form of the **Delivery Loop** in `CLAUDE.md`. It composes
existing skills — it does not replace any of them or add new tooling. Run it
autonomously for behavior changes; don't wait to be prompted between steps. Each
step runs in order; skip one only with an explicit reason.

Two layers of verification run here, per the feedback-loops model: **self-verify
while building** (steps 2–5) and an **independent review before merge** (step 6,
a fresh agent that didn't write the code).

## The loop

1. **Clarify.** Restate the request, surface assumptions, ask before assuming.
   For non-trivial scope, plan first with `superpowers:brainstorming` →
   `superpowers:writing-plans` (or `drill-me-with-docs`). Plan body in the user's
   language (Chinese/English); code, identifiers, paths, commands stay English.

2. **TDD.** `superpowers:test-driven-development` — failing behavior test first,
   smallest change to green, refactor. Test at the public boundary (rendered UI,
   `DikwClient`, browser flows), not private wiring. See `docs/tdd.md`.

3. **Simplify.** Run `/simplify` on the diff (reuse, simplification, altitude).
   Quality only — it does not hunt bugs.

4. **Verify behavior deterministically.** `npm.cmd run lint` + `npm.cmd run
   typecheck`, then the smallest useful `npx vitest run <file>` while iterating.
   Do not lower the coverage thresholds in `vite.config.ts` to pass. `npm.cmd run
   format` keeps Prettier happy (both `lint` + `format:check` are in `verify`).

5. **Verify in the browser.** If the change touched UI (`src/pages`,
   `src/components`, `src/styles.css`, chrome), invoke **`dikw-web-verify-frontend`**
   — exercise the changed routes in a real browser, confirm a clean console on
   real data, and run the `docs/ui-checklist.md` rubric in light + dark. Don't
   substitute a green e2e run for actually seeing it render.

6. **Independent review (max 3 rounds).** Repeat until no new actionable findings
   or the cap is hit: `/codex:review --background` → evaluate, keep the valid
   findings, fix. Then a final `/code-review` pass; resolve every finding. Point
   the reviewer (codex, a fresh agent, or yourself) at **`docs/review-rubric.md`**
   so the project-specific principles get scored, not just generic correctness.
   (Note: with `gh pr merge --auto`, CodeRabbit is often outraced and never
   reviews — see [[feedback_pr_reviews_check]]; this local pass is the real gate.)

7. **Sync docs.** Walk `CLAUDE.md`, `README.md`, and relevant `docs/*.md` against
   the diff. Any contract/behavior/command/doc-index that drifted is updated in
   the **same** change — not "later". (Disk `.md` is English-only in this repo.)

8. **Final gate + PR.** `npm.cmd run verify` (lint + format:check + typecheck + coverage + build + e2e)
   green, then `npm.cmd run check:bundle` (gzip budget) and `npm.cmd run check:gate`
   (reward-hacking gate; both also run in CI — the latter as the required
   `gate-integrity` job). If `check:gate` flags a *deliberate* weakening, a maintainer
   adds the `gate-change` label to the PR; never route around it. Bump
   `package.json` version (3-digit SemVer) and add a `CHANGELOG.md` entry when
   warranted. Branch with a descriptive name, commit `<type>(<scope>): <subject>`,
   push, `gh pr create`.

9. **Watch CI + PR comments; resolve then merge.** Invoke the **`dikw-web-watch-ci`**
   skill — the executable form of this step, with the brakes built in (MAX_ROUNDS = 3,
   a same-failure circuit breaker, and a **one**-rerun budget for the known flaky
   `graph.spec.ts` Pixi test). It watches `gh pr checks <N> --watch`, routes real
   failures to the fresh-context `fixer`, **always pulls the review prose** (`reviews` /
   `pulls/{N}/comments` / `issues/{N}/comments` — `gh pr checks` shows pass/fail only)
   before merge, and merges explicitly (`gh pr merge <N> --squash --delete-branch`, never
   `--auto`, which would outrace the review) once CI is green and every actionable
   comment is resolved. Each transition is appended to `.loop-log.jsonl` via
   `scripts/loop-log.mjs` so an overnight run is diagnosable.

## Repo gotchas this loop must honor

- New `server/**` runtime modules: relative imports carry a `.js` extension
  (`*.test.ts` excepted) — typecheck/build won't catch a missing one, only review
  will. (memory `project_server_js_import_extension`)
- Multi-line git/gh bodies: use `<<'EOF'` heredoc or `--body-file`, not PowerShell
  `@'...'@`. (memory `feedback_bash_tool_heredoc`)
- Don't pipe a pass/fail command into `tail` — the exit code becomes tail's
  (always 0) and masks e2e failures. (memory `feedback_pipe_tail_masks_exit`)
- Dependabot rebases: comment `@dependabot rebase`, never the update-branch API.
  (memory `feedback_dependabot_no_update_branch`)
