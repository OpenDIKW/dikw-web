# dikw-web contributor instructions

## Start each new session

The SessionStart hook runs the repository's compatibility check. If this session has no `harness-doctor: OK` receipt, run the following command from the current worktree root before working.

```sh
node scripts/harness-doctor check
```

If the check reports drift, inspect the named paths. Preserve intentional edits in `harness/`, run the same command with `sync`, then repeat `check`. Reconcile unregistered files by hand. The check is read-only. A missing runtime or an untrusted hook needs a new check before claiming success.

Before designing or editing a file, run `node scripts/harness-doctor rules <path> [<path> ...]` from the root and read **every** returned file. Use this lookup for planned files and when the client omits automatic path rules. Edit the canonical bodies, scope patterns, agent definitions and hooks under `harness/`. Regenerate and check the adapters in the same change.

## Working agreement

- Write plans and reports in the user's language. Repository documentation, code and identifiers are English. Use `CONTEXT.md` for product terminology and `DESIGN.md` for UI decisions.
- Preserve the frozen `/agent/*` and `AgentStreamEvent` contracts. Core maintenance requires the user's confirmation. Keep provider credentials server-side. Settings may store the user's core token in token mode. Mask it in the UI and keep token values out of logs and screenshots.
- Keep chat at `#chat`, settings in charge of the core connection, and user content in its original language. Consume shared packages through their public exports.
- TDD is the default. Before diagnosing a data-shape problem, inspect the live contract. The e2e suite mocks `/v1`; verify a changed contract against a real core. Visually verify UI changes in a real browser in light and dark modes.
- On Windows use `npm.cmd` and `npx.cmd` from PowerShell. Run `npm.cmd run verify`, `check:bundle` and `check:gate` before delivering behavior changes. Keep assertions, coverage, budgets and e2e failure reporting intact.
- Use `dikw-web-delivery-workflow` and its review tiers. Use a fresh reviewer for high-risk changes and the `fixer` when the same check fails twice. Stop after five failed attempts. A deliberate gate-machinery change follows the maintainer's `gate-change` process.
- State material assumptions. Keep the change scoped, verify evidence from this run, and continue until the requested completion condition. Ask when a decision blocks progress.
- The delivery workflow covers commit, push, PR, reviewed squash merge and branch cleanup. Never force-push. Watch CI and review comments before the explicit squash merge. Record the result in the loop log.
- Close reports with decisions needed, changes and findings.
