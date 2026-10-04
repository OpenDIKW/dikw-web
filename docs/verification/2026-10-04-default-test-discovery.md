# Default test discovery followup

This followup resolves the deferred Playwright discovery finding from
[PR #219](https://github.com/OpenDIKW/dikw-web/pull/219). Renaming a mocked spec
into the ignored live directory must remain a verification loss. It is a
separate gate correction before the public MB business cleanup.

## Scope and invariants

The gate reads declared default discovery without executing repository
configuration. It respects the ordinary conditional branch, testMatch and
testIgnore, quoted keys, literal spreads, regex/glob matches and hidden paths.
It rejects unresolved discovery values, shorthand/accessor properties,
indirect projects and additional configuration arguments. Vitest's default
node_modules/.git exclusions apply when test.exclude is absent; an explicit
empty exclusion list is preserved. Coverage.exclude affects the denominator
and is not a test-discovery exclusion.

All original assertions and the default 5-second test timeout are retained.
Coverage remains 60/45/55/60, gzip budgets 280/1950/35 KB, and the retry policy
is unchanged. The script itself still requires an auditable gate-change label.
The shared npm cohort remains 0.1.0 and its runtime/API is unchanged.

## Evidence

- The synchronized generic fix passed 56 tests on the public WSL host. The
  privately reviewed final fix added shorthand/default-exclusion regressions.
- Public independent review found three further unsupported forms: a discovery
  getter, indirect projects, and multiple defineConfig arguments. Three real
  Git rename regressions first failed because the gate incorrectly exited 0.
  After the correction, all **62** gate tests passed in WSL with one worker
  and unchanged deadlines (6.96 seconds total suite duration).
- The independent targeted resolution check for those three findings is clean. The actual public
  Playwright config preserves ordinary specs and rejects a move into live.
- A fresh Linux checkout of public base `165ed9c` with the eight-file candidate
  overlay completed every verify stage: lint, formatting, types, **1,309 tests
  in 104 files**, coverage, production build, **58 Chromium flows**, and three
  independently installed package consumers. Coverage was
  77.40/68.02/77.46/79.19%; gzip was 278.0/1854.4/30.4 KB. The production audit
  had no high or critical findings (four existing moderate dependency findings).
  Coverage used one worker and Playwright two workers; original deadlines and
  assertions were unchanged. Two existing opt-in live web-tool tests remained
  skipped. This was the complete decomposed verification sequence, not one
  local invocation of `npm run verify`.
- Hosted checks and review must pass before merge; their exact commit and run
  are recorded in the PR. No business source or public hash routing is removed
  by this gate-only change.
- The third independent pass (remote review on `015a6d8`) found two additional
  traversal/environment omissions. Both real-Git regressions first failed with
  the gate incorrectly exiting 0. The final correction skips dependency
  directories below testDir (while preserving an explicitly selected testDir)
  and rejects unknown environment conditions. All **66** gate tests passed in
  WSL with the original deadlines. The implementation follows the pinned
  [Playwright collector](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright/src/runner/projectUtils.ts#L215-L221)
  and avoids assuming GitHub's [default variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
  are unset. Complete final-source verification passed in a fresh Linux
  checkout based on `5a2fb2f`: **1,313 tests in 104 files**, coverage
  77.40/68.02/77.46/79.19%, **58 zero-retry Chromium flows**, all three
  independent consumers, gzip 278.0/1854.4/30.4 KB, and no production
  high/critical audit findings. Lint, formatting, types and build passed.
  Original deadlines/assertions and the two opt-in live skips are unchanged.

## Maintainer gate judgment

[PR #220](https://github.com/OpenDIKW/dikw-web/pull/220) carries the visible
`gate-change` label under the maintainer's authorization to complete subsequent
operations. The unlabelled local check reported only `gate-machinery-modified`;
no tests, assertions, coverage floors, budgets or retries were weakened.
The initial CI event started before the label was attached and therefore had
`GATE_HAS_OVERRIDE=false`. This documentation commit records the judgment and
creates a new synchronization event with the existing label. The original
failure is retained in run `37211879556`; it is not a flaky-test rerun.

## Stable release and remaining cutover

All three shared packages were actually published as 0.1.0/latest from public
commit 165ed9ccaf17664d53976599190233129b438148. The
[publication workflow](https://github.com/OpenDIKW/dikw-web/actions/runs/37207050219)
passed full verify, bundle budgets, registry byte integrity and independent
registry consumers. The private application has adopted exact registry
dependencies. PR #3 and the private theme followup PR #4 are merged; final
private image/backup/runtime acceptance remains a prerequisite for removing
the embedded business app.
