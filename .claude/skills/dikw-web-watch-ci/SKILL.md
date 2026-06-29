---
name: dikw-web-watch-ci
description: Watch a dikw-web PR's CI to green and merge it — the executable form of delivery-loop step 8. Use after gh pr create to monitor checks + review prose, route real failures to a fresh-context fixer, rerun the one known flake at most once, and squash-merge only once CI is green AND the independent review has actually landed. Bounded by a max-rounds fuse and a same-failure circuit breaker.
---

# Watch CI + resolve + merge (dikw-web)

Turn delivery-loop **step 8** ("monitor CI and PR comments; resolve then merge") from
prose into a bounded, self-logging loop, so a pushed PR converges to merged without
turning the session into a turn-based polling game. Two failure modes this prevents:
the independent review being **outraced** by an auto-merge, and a flaky e2e being
**retried five times** instead of once.

Inputs: the PR number `<N>` (from `gh pr create`). Everything else is read from `gh`.

## Brakes (read first — these bound the loop)

- **MAX_ROUNDS = 3.** A "round" is one watch→diagnose→fix→re-push cycle. Hit the cap →
  **stop and hand back to the human** with the current red signal; do not loop forever.
- **Circuit breaker.** If the **same** CI job fails with the **same** root cause twice
  in a row, stop — you are guessing, not fixing. Escalate to the human (or re-diagnose
  root-cause-first via `superpowers:systematic-debugging`).
- **Flaky rerun budget = 1.** The one known flake (`graph.spec.ts`, Pixi canvas — see
  [[project_flaky_graph_e2e]]) gets **exactly one** `gh run rerun`, never five. A second
  failure of the same spec is treated as a real failure, not a flake.
- Log every transition with `scripts/loop-log.mjs` (see "Observability" below) so a
  loop that dies overnight is diagnosable in the morning.

## The loop

1. **Watch.** `gh pr checks <N> --watch --interval 30` blocks until every check is
   terminal. Log `iter_start`.
2. **All green?** Go to step 6 (merge).
3. **A check failed → classify it.** `gh run view <run-id> --log-failed` for the failing
   job (`gh pr checks <N>` lists the run URLs).
   - **Known flake** (`graph.spec.ts > "renders a nonblank Pixi graph canvas"`, and only
     if it has not already been reran this PR): `gh run rerun <run-id> --failed`, log
     `flake_rerun`, go back to step 1. **Once only.**
   - **Real failure**: continue to step 4.
4. **Fix via fresh context.** Hand the failing command + the `--log-failed` output to
   the **`fixer`** agent (`.claude/agents/fixer.md`) — a clean context that did not write
   the code and is forbidden from weakening tests (and now mechanically blocked by the
   `gate-integrity` gate). Log `fixer` with the one-line root cause it reports.
5. **Re-push + re-evaluate.** Commit the fix, push. CodeRabbit/CI re-evaluate the new
   SHA. Increment the round counter; if it exceeds **MAX_ROUNDS** or the breaker tripped,
   stop and hand back. Otherwise go to step 1.
6. **Pull the review prose before merging — always.** `gh pr checks` shows pass/fail,
   not prose, and `gh pr merge --auto` would outrace it. Read:
   - `gh api repos/{owner}/{repo}/pulls/<N>/reviews` (review bodies — e.g. the Codex
     different-model judge)
   - `gh api repos/{owner}/{repo}/pulls/<N>/comments` (inline threads)
   - `gh api repos/{owner}/{repo}/issues/<N>/comments` (top-level CodeRabbit summary)

   Resolve **each** actionable finding: fix + re-push (back to step 1), refute with
   evidence in a reply, or defer explicitly with a rationale in the PR body. A
   `gate-change` finding means a maintainer must judge + label, not route around it.
7. **Merge explicitly.** Only once CI is fully green **and** the review has actually
   landed and is resolved: `gh pr merge <N> --squash --delete-branch`. Do **not** use
   `--auto` (it merges before the review posts). Log `merged`.
   - **Worktree quirk:** from a git worktree, `gh pr merge` may print
     `fatal: 'main' is already used by worktree …` yet **merge remotely anyway**. Verify
     with `gh pr view <N> --json state,mergeCommit` and, if `--delete-branch` was skipped
     by the error, `git push origin --delete <branch>` manually. (memory
     [[project_worktree_merge_quirk]])

## Observability

Append a structured line at each transition so the run is diagnosable:

```
node scripts/loop-log.mjs iter_start "PR <N> round <r>"
node scripts/loop-log.mjs flake_rerun "graph.spec.ts"
node scripts/loop-log.mjs fixer "<one-line root cause>"
node scripts/loop-log.mjs ci_fail "<job name>"
node scripts/loop-log.mjs merged "PR <N>"
```

`.loop-log.jsonl` is gitignored. After the loop, summarize it into the PR body's
`<!-- loop-log -->` section (rounds, reruns, fixer escalations) so the run's shape is
visible without the raw file. Grepping the log tells you which of the four classic loop
deaths happened: runaway (many `ci_fail`, no `merged`), stuck (same `ci_fail` repeating),
or a flake never converging.

## Honoring repo gotchas

- One flaky rerun, not five (above).
- Multi-line `gh` bodies: `--body-file` or a `<<'EOF'` heredoc, never PowerShell `@'…'@`.
  (memory [[feedback_bash_tool_heredoc]])
- Don't pipe a pass/fail command into `tail` — the exit code becomes tail's (always 0)
  and masks failures. (memory [[feedback_pipe_tail_masks_exit]])

This skill is the executable form of **step 8** of `dikw-web-delivery-workflow`.
