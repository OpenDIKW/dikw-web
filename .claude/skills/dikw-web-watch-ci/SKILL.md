---
name: dikw-web-watch-ci
description: Watch a dikw-web PR's CI to green and merge it — the executable form of delivery-loop step 9. Use after gh pr create to monitor checks + review prose, route real failures to a fresh-context fixer, rerun an infrastructure failure at most once, and squash-merge only once CI is green AND the independent review has actually landed. Bounded by a max-rounds fuse and a same-failure circuit breaker.
---

# Watch CI + resolve + merge (dikw-web)

This skill turns step 9 of `dikw-web-delivery-workflow` into a bounded loop that logs itself.
A pushed PR moves to merged without turn-by-turn polling. It prevents two failure modes:

- An auto-merge that **outruns** the independent review.
- A failure that gets **rerun until it passes** instead of being fixed.

Input: the PR number `<N>` from `gh pr create`. Read everything else from `gh`.

## Brakes (read first — they bound the loop)

- **MAX_ROUNDS = 3.** A round is one watch → diagnose → fix → push cycle. At the cap, **stop and hand back to the human** with the current red signal.
- **Circuit breaker.** If the **same** CI job fails with the **same** root cause twice in a row, stop. You are guessing, not fixing. Diagnose the root cause again, or escalate to the human.
- **Rerun budget = 1, for infrastructure failures only** (lost runner, network or registry timeout, GitHub outage). No known flake remains: the Pixi `graph.spec.ts` race was fixed in PR #140. CI already gives each e2e test `retries: 2`, so a test that still fails has failed three times. Treat it as a real failure, not a flake.
- Log every transition with `scripts/loop-log.mjs` (see "Observability"), so a loop that dies overnight can be diagnosed in the morning.

## The loop

1. **Watch.** `gh pr checks <N> --watch --interval 30` blocks until every check is terminal. Log `iter_start`.
2. **All green?** Go to step 6.
3. **A check failed → classify it.** Read the failing job with `gh run view <run-id> --log-failed` (`gh pr checks <N>` lists the run URLs).
   - **Only infrastructure jobs failed, first time on this PR:** rerun just those jobs with `gh run rerun <run-id> --job <job-id>` (`gh run view <run-id> --json jobs` lists the ids). Do not use `--failed`: it also reruns failed test jobs. Log `flake_rerun`, go back to step 1. **Once only.**
   - **A test job failed too:** do not rerun. It is a real failure.
   - **Anything else:** a real failure. Continue to step 4.
4. **Fix in a fresh context.** Give the failing command and the `--log-failed` output to the **`fixer`** agent (`.claude/agents/fixer.md`).
   It did not write the code, and it may not weaken tests (the `gate-integrity` job also blocks that). Log `fixer` with the one-line root cause it reports.
5. **Push and re-evaluate.** Commit the fix and push. CodeRabbit and CI re-evaluate the new SHA.
   Increment the round counter. If it exceeds **MAX_ROUNDS**, or the breaker tripped, stop and hand back. Otherwise go to step 1.
6. **Read the review prose before you merge — always.** `gh pr checks` shows pass/fail, not prose, and `gh pr merge --auto` would outrun it. Read:
   - `gh api --paginate repos/{owner}/{repo}/pulls/<N>/reviews` (review bodies, for example the Codex review)
   - `gh api --paginate repos/{owner}/{repo}/pulls/<N>/comments` (inline threads)
   - `gh api --paginate repos/{owner}/{repo}/issues/<N>/comments` (top-level CodeRabbit summary)

   The list endpoints return 30 items per page, so `--paginate` is required.

   Resolve **each** actionable finding: fix and push (back to step 1), refute it with evidence in a reply, or defer it with a reason in the PR body.
   A `gate-change` finding needs a maintainer's judgment and label. Do not route around it.
   If a reviewer set `CHANGES_REQUESTED` or raised a design-level concern, stop and hand back to the human. It is a block signal.
7. **Merge explicitly.** Merge only when CI is fully green **and** the review has landed and is resolved: `gh pr merge <N> --squash --delete-branch`. Do **not** use `--auto`; it merges before the review posts. Log `merged`.
   - **Worktree quirk:** from a git worktree, `gh pr merge` can print `fatal: 'main' is already used by worktree …` and still merge remotely. Check with `gh pr view <N> --json state,mergeCommit`. If the error skipped `--delete-branch`, run `git push origin --delete <branch>`.

## Observability

Append one structured line at each transition:

```
node scripts/loop-log.mjs iter_start "PR <N> round <r>"
node scripts/loop-log.mjs flake_rerun "<job name>: <infrastructure cause>"
node scripts/loop-log.mjs fixer "<one-line root cause>"
node scripts/loop-log.mjs ci_fail "<job name>"
node scripts/loop-log.mjs merged "PR <N>"
```

- `.loop-log.jsonl` is gitignored.
- After the loop, summarize it in the PR body's `<!-- loop-log -->` section: rounds, reruns, fixer escalations.
- Grep the log to see how a loop died: runaway (many `ci_fail`, no `merged`), stuck (the same `ci_fail` repeats), or a rerun that never converged.

## Repo gotchas

- Multi-line `gh` bodies: use `--body-file` or a `<<'EOF'` heredoc, never PowerShell `@'…'@`.
- Do not pipe a pass/fail command into `tail`. The exit code becomes tail's (always 0) and hides failures.
