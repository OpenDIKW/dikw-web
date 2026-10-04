# ADR 0007: Independent applications with public shared packages

Status: Accepted.

## Context

The public workbench and embedded MB application import the same source tree,
configuration, UI and BFF. The workbench manages a knowledge base; MB provides
paper research, Q&A and notes. Their product boundaries and repository access
need to be independent while avoiding duplicate protocol and reader code.

## Decision

Keep workbench and three MIT workspace packages in public `dikw-web`: client,
UI and server. Publish compiled ESM/declarations through public npm. Move MB
business code to private sibling repository `dikw-mbweb`, consuming exact
registry package versions and its own lockfile. No private checkout or token
is used by public CI. MB business code is not included in public tarballs.

Both applications use one Core knowledge base, managed by workbench. Deploy
each application's BFF in a separate process with its own OIDC client,
session secret, database directory and volume. This isolates BFF sessions and
jobs, not the contents of the shared Core knowledge base.

The shared server factory owns resources and returns `handler`/`close`; each
application owns listening, signals, environment and static build. Workbench
retains its capabilities. A server-fixed MB profile allows its existing
business API closure and denies maintenance, proposals, traces and unknown
APIs before dispatch. The Vite adapter applies the same policy before proxying.
Production MB requires OIDC and a stable public logical Core ID. Its auth
response exposes issuer/Core ID for identity-scoped browser storage.

Shared React remains a peer. UI exports provide controls, readers and theme
mechanics; applications own navigation, translations, branding, layouts and
business models. Browser notes, aliases and caches in independent MB are
partitioned by issuer, subject and Core ID. Legacy data is never assigned to
the first user. The maintainer later retired the private Settings/import/export
UI (private PR #6); the public legacy link retains a local backup download.

## Rollout and consequences

Extract and verify client, UI and server sequentially while embedded MB still
works. Validate packed packages outside the checkout, publish a candidate,
validate the private app, provide migration, then publish stable packages and
remove public MB business code. Keep the legacy migration route during the
transition. Backups and real Core/Casdoor acceptance precede deployment cutover.

The public `#MB-Web` route is now a lazy local backup notice with a fixed,
validated destination. It does not boot the business app or probe authentication.
The workbench authenticates normally when selected. Build checks cover the
finite former business modules, static assets and sourcemap paths while preserving
shared profile/reader code. Business tests move to private CI with the recorded
transfer ledger; public tests and quality thresholds remain in force.

Package releases are versioned together for the first cohort. Neither shared
source deep imports nor sibling `file:` dependencies remain in the delivered
private app. Existing test assertions, #204/#205 regressions and quality gates
are retained; real service evidence is reported separately from fixtures.
