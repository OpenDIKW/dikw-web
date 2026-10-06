---
name: dikw-web-delivery-workflow
description: The end-to-end dikw-web delivery loop, from request to merged PR. Use for any behavior change in this repo (feature, fix, refactor that changes behavior). Runs clarify → TDD → simplify → deterministic verify → browser verify → tiered review → doc sync → final gate + PR → watch CI and merge, and stops only on its block signals. Skip only for trivial edits (typo, comment, one-line refactor).
---

# dikw-web delivery workflow

This skill is the only definition of the dikw-web delivery loop. CLAUDE.md points here.
It composes existing skills and commands; it adds no new tooling.

**Finish line.** The loop is done when all of these are true:

- The PR is squash-merged with an explicit `gh pr merge <N> --squash --delete-branch`. Local `main` is synced.
- Every CI check is green. Every actionable review comment is fixed, refuted with evidence, or deferred with a reason in the PR body.
- `.loop-log.jsonl` has a `merged` line for the PR.

If you cannot reach the finish line, stop on a block signal and report it.

**Run autonomously.** The loop is approval to commit, push, open the PR, merge it when it is green and reviewed, and delete the merged branch. Do not wait for a prompt between steps. Run the steps in order. Skip a step only with a stated reason.
Put status notes in the same message as your next tool call.

There are two layers of verification: **self-verify while you build** (steps 2–5) and an **independent review before merge** (step 6).

## The loop

1. **Clarify.**
   - Restate the request. State your assumptions.
   - Ask a blocking question with the AskUserQuestion tool. Put your recommended answer first.
   - For non-trivial scope, write a plan before you write code.
   - Write the plan in the user's language (Chinese or English). Keep code, identifiers, paths, and commands in English.
   - Pick the review tier now (see step 6).

2. **TDD.** Write a failing behavior test first, then the smallest change to green, then refactor.
   Test at the public boundary (rendered UI, `DikwClient`, browser flows), not private wiring. See `docs/tdd.md`.

3. **Simplify.** For a code change, run `/simplify` on the diff (reuse, simplification, altitude). It checks quality only; it does not hunt bugs.

4. **Verify behavior deterministically.**
   - Run `npm.cmd run lint` and `npm.cmd run typecheck`, then the smallest useful `npx vitest run <file>` while you iterate.
   - Run `npm.cmd run format` so Prettier passes (`lint` and `format:check` are both in `verify`).
   - Do not lower the coverage thresholds in `vite.config.ts` to pass.

5. **Verify in the browser.** If the change touched UI (`src/pages`, `src/components`, `src/styles.css`, `packages/web-ui`, chrome), run **`dikw-web-verify-frontend`**.
   It exercises the changed routes in a real browser, checks for a clean console on real data, and runs the `docs/ui-checklist.md` rubric in light and dark.
   A green e2e run does not replace seeing the change render.

6. **Independent review — tiered by risk.** Find the highest tier that any file in the diff hits. When in doubt, go one tier up.

   | tier | the diff touches | review |
   |---|---|---|
   | **S** | only docs outside `src/` and `packages/*/src/` (`*.md`, `docs/**`, `.claude/skills/**`, `.claude/rules/**`); or a version / CHANGELOG-only release bump | `/code-review` once |
   | **M** | anything else: code, tests, scripts, dependencies | codex (≤ 3 rounds) + `/code-review` |
   | **L** | `packages/web-server/src/auth/**`, `requestRouter.ts`, the frozen `/agent/*` contract, Markdown sanitizing in `packages/web-ui/src/reader/**`, the publish flow (`scripts/*publish*`, `publish-packages.yml`), or the gate machinery (`scripts/check-gate-integrity.mjs`, `.github/workflows/**`, `.claude/agents/fixer.md`) | tier M + a fresh-context subagent review |

   - **Codex:** run `codex review --base main` in the background. The `/codex:review` slash command is user-only, so call the CLI. Fix, then run it again. Stop after 3 rounds or when a round has no new actionable finding.
   - **`/code-review`:** run it once after the codex rounds. Point it at **`docs/review-rubric.md`** so the project rules get scored, not only generic correctness.
   - **Fresh-context review (tier L):** spawn a subagent with only the diff and `docs/review-rubric.md`. It did not write the code; do not give it your reasoning.
   - **Triage every finding the same way.** Ask each reviewer to report merge-blocking problems first, each with the file and line, why it is wrong, and how to show that it fails. Read the cited code before you fix. Fix every actionable finding, blocking or not. Reject a nitpick or a false positive with a one-line reason.
   - This local review is the real gate. If you merge with `--auto`, CodeRabbit is often outrun and never reviews.

7. **Sync docs.** Check `CLAUDE.md`, `.claude/rules/**`, `README.md`, and the relevant `docs/*.md` against the diff.
   Update every contract, behavior, command, or doc index that drifted, in the **same** change. Markdown on disk is English-only in this repo.

8. **Final gate + PR.**
   - `npm.cmd run verify` (lint + format:check + typecheck + coverage + build + e2e) must be green. Then run `npm.cmd run check:bundle` (gzip budget) and `npm.cmd run check:gate` (reward-hacking gate). CI runs both too; `check:gate` is the required `gate-integrity` job.
   - If `check:gate` flags a *deliberate* weakening, a maintainer must add the `gate-change` label. **WARNING:** never route around the gate.
   - When the change warrants it, bump `package.json` version (3-digit SemVer) and add a `CHANGELOG.md` entry under the matching version heading. On merge to `main`, CI's `release` job cuts the GitHub Release `dikw-web-v<version>` from `package.json`. Only a version bump creates a new tag.
   - Branch with a descriptive name. Commit as `<type>(<scope>): <subject>` (see recent `git log`). Push. Run `gh pr create`.
   - CI runs lint + format:check + typecheck + coverage + build + e2e + bundle budget + `gate-integrity` + security scans (npm audit, gitleaks, Trivy, CodeQL).

9. **Watch CI + PR comments; resolve, then merge.** Run the **`dikw-web-watch-ci`** skill.
   It watches checks and review prose, sends real failures to the `fixer` agent, reruns a failed e2e at most once, logs each transition to `.loop-log.jsonl`, and merges explicitly (never `--auto`).
   End with the Report section from CLAUDE.md.

## Block signals — stop and ask

Stop only when one of these occurs. For everything else, continue.

1. CI stays red after the `dikw-web-watch-ci` brakes (3 rounds, or the same failure twice).
2. A reviewer sets `CHANGES_REQUESTED` or raises a design-level concern.
3. The change needs a deliberate verification weakening. Only a maintainer can add `gate-change`.
4. The change needs a different frozen contract (`/agent/*`, `AgentStreamEvent`) or a `dikw-core` change.
5. A merge conflict needs a product decision, not a mechanical resolve.
6. **WARNING:** a force-push would be necessary. Force-push is forbidden. Describe the situation and let the user do it.
7. The request is ambiguous on a decision that the code and docs cannot answer.
8. The next action is destructive and this loop does not already approve it: deleting data or files you did not create, or changing anything outside this repository.

## Repo gotchas this loop must honor

- New `server/**` and `packages/web-server/**` runtime modules: relative imports carry a `.js` extension (`*.test.ts` excepted). Typecheck and build do not catch a missing one; only review does.
- Multi-line git or gh bodies: use a `<<'EOF'` heredoc or `--body-file`, not PowerShell `@'...'@`.
- Do not pipe a pass/fail command into `tail`. The exit code becomes tail's (always 0) and hides e2e failures.
- Dependabot rebases: comment `@dependabot rebase`. Never use the update-branch API.
