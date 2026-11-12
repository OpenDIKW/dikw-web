# Shared npm packages

The public workbench maintains three MIT packages. The independent private MB
application installs exact versions from public npm; public CI never checks out
that repository. Each release uses one version for all three packages and their
internal dependencies. Candidates `0.1.0-rc.1` and `0.1.0-rc.2` were published
under `next`. The second adds immutable page-scoped Agent sessions and passed
actual GitHub OIDC publication, registry-byte verification and independent
consumers in [run 37178344897](https://github.com/OpenDIKW/dikw-web/actions/runs/37178344897).
The private application passed independent registry installation, hosted CI,
real data migration and an authenticated production-container reader/restart.
Stable cohort `0.1.0` has been published and accepted by the private application.
Cohort `0.1.1` aligns MikroORM core/SQLite dependencies at 7.2.3 and has been
published and accepted. Cohort `0.1.2` fixes long conversion names and adds
indexed source/active attachment preflight plus detailed import warnings and
rejections. Consumers must also skip tasks for zero commits and make whole-base
synth an explicit user action after ingest. See the client README and
`docs/core-contract.md#import` for index/concurrency/archive limits. Validate the
actual artifacts in both applications and complete release review and CI before
dispatching publication. Published `0.1.0` bytes remain immutable; the patch
creates new versions.

Cohort `0.1.3` fixes scientific inline markup, converted-table text preservation
and heading anchors in the shared reader. Upgrade all three exact dependencies
together; already-imported sources need no reconversion. Reuse
`tests/fixtures/scientific-markdown.json` from this repository for downstream
reader acceptance. Unsafe HTML remains inert and code examples remain literal.

Cohort `0.1.4` fixes the six high-severity CodeQL polynomial-backtracking
findings in image references, heading wikilinks, details and chart whitespace.
Delimiter scans retain the existing supported grammar and offsets; incomplete
markup remains inert. Upgrade all three exact dependencies together. The
`rawDetailsPattern` compatibility object supports `exec`, `matchAll` and
`replace`; use these operations directly rather than cloning its `.source`.
Existing sources require no reconversion. See
`docs/verification/2026-10-06-markdown-redos.md` for regression evidence.

Cohort `0.1.5` stops the `@opendikw/web-server` logger from writing `Error`
messages, which can echo provider credentials, to stdout and OTel log records. An
`Error` field now logs as `Class [CODE]` (a known system or transport code) instead
of `Name: message`, and any other object value as `[object]`; update log queries that
match error text. A handler error recorded on a SERVER span likewise exports only its
class and known code; update trace queries that match its message. Upgrade all three exact dependencies together; no configuration
changes.

Cohort `0.1.6` aligns MikroORM core, SQLite and SQL at `7.2.5` and updates
markdown-it to `15.0.3`, fixing CVE-2026-111758 in the shared document parser and
reader. It also includes the current AI SDK and telemetry dependency updates.
Upgrade all three exact dependencies together. Existing documents need no
reconversion, and SQLite Agent sessions retain their existing storage format.

Cohort `0.1.7` updates undici to `8.12.3`, ADK to `2.4.0`, Anthropic SDK to
`1.3.0` and Lucide to `1.64.0`. It explicitly preserves stale-session reloads
for concurrent Agent turns and chat renames during streaming. Both MiniMax
clients retain their existing authentication/API-version headers and disable
native SDK telemetry, leaving outbound tracing endpoint-gated and content-free.
No storage-format or HTTP/NDJSON contract migration is required. Upgrade all three
exact dependencies together. Existing consumer lockfiles can retain vulnerable
transitive DOMPurify/Zod versions; refresh them and enforce the DOMPurify override
floor shown below before accepting the upgrade.

| Package | Public entries | Runtime requirements |
| --- | --- | --- |
| `@opendikw/web-client` | `/core`, `/agent`, `/types`, `/import`, `/convert`, `/translate`, `/document`, `/connection` | Node 24 for Node consumers; browser helpers use browser APIs |
| `@opendikw/web-ui` | `/controls`, `/reader`, `/hooks`, `/auth`, `/theme`, `/tokens.css`, `/controls.css`, `/reader.css` | React/ReactDOM 19 peers; reader diagram engines load on demand |
| `@opendikw/web-server` | `/runtime`, `/instrumentation`, `/vite` | Node 24; Vite 8 is an optional peer only for `/vite` |

Application models, routes, branding, credentials and customer assets stay outside
the packages. Only `dist`, `README.md`, `LICENSE` and npm's package manifest ship.
Use public exports; source deep imports are unsupported. Package README files
retain extraction provenance and document runtime behavior.

## Verify before publishing

Candidate cohort `0.1.9-rc.1` adds optional request-scoped model resolution with
live identity checks before Agent, compaction and translation calls. Client hooks
support safe application headers and explicit fetch transports throughout Core
and Agent operations. Existing applications without a resolver retain the default
transport. Translation cancellation during model selection no longer starts an
orphan job; safe model-selection failures retain actionable status/error codes.
Pending model resolution observes runtime shutdown, reasoning-only Agent replies
fail explicitly, and transient translation transport failures retain bounded retries.
No Agent HTTP/NDJSON or stored-session format migration is required. Install all
three exact candidate versions together and validate independent applications and
production images before preparing a new stable cohort. Candidate publication and
registry-byte acceptance are separate steps; local packing alone proves neither.

Candidate cohort `0.1.9-rc.2` additionally exposes
`createWebRuntime({ publicBasePath: "/knowledge-base" })` for applications
served behind a path-prefix proxy. The option describes the external OIDC
authorization, callback and post-logout URLs. The configured public URL remains
the trusted origin, and runtime handlers still receive paths with the mount
prefix removed. The application owns path stripping, Cookie Path and
Location/authentication HTML rewriting; this option is not a routing adapter.
No private package modules are required. Root-path applications retain their
existing behavior. Upgrade all three exact candidate dependencies together.

```sh
npm run version:shared -- 0.1.9-rc.2
npm install --package-lock-only --ignore-scripts
npm run verify
npm run check:bundle
npm run check:gate
```

`verify` includes `verify:packages`: explicit build, pack and independent consumer
installs outside the checkout. Node HTTP/NDJSON, strict NodeNext declarations,
all public entries, shared React/auth context, reader hydration/CSS/fonts and a
production runtime with SQLite persistence/shutdown are exercised. The Node
runtime consumer has no React, UI or Vite installation. Coverage thresholds,
bundle budgets, browser assertions and required CI check names stay unchanged.

`pack:shared` rejects non-exact runtime dependencies, different cohort versions,
missing declarations or resources, source imports outside `dist`, undeclared
dependencies and application/test/config/database files. It writes
`.tmp/shared-packages/manifest.json` with the source commit, versions, tarball
names and SHA-512 integrity. Build is explicit because `.npmrc` disables scripts.

Commit the version/lockfile changes and complete PR review/CI before release.
Packing an uncommitted tree is useful for development; its manifest records
`sourceClean: false` and cannot be published even after restoring the source.
The packer clears package-owned build output before compiling and checks source
cleanliness before and after packing. Publishing requires artifacts packed from
a clean checkout, a clean current checkout and a manifest matching `HEAD`.
Publication validates all three
registry versions before the first write. An identical already-published version
with the requested tag is skipped; conflicting bytes or tags stop the release.
Receipts are written after each successful publication, allowing a partial release
to resume with the same verified artifacts. Existing versions are never replaced
or silently retagged.

## First publication and trusted publishing

An npm account with permission to create the three `@opendikw` packages must
perform the initial authenticated publication from the reviewed release commit:

```sh
npm run verify:packages
npm run publish:shared -- --tag next --dry-run
npm run publish:shared -- --tag next
npm run verify:registry
```

Do not put npm credentials in the repository. Until account/scope permissions are
available, publication and registry validation remain pending; local tarball
verification does not count as a registry release.

After each package exists, configure its npm trusted publisher with organization
`OpenDIKW`, repository `dikw-web`, and workflow filename `publish-packages.yml`.
Enable the **npm publish** action: newer npm publisher configurations default to
stage-publish authorization. The current workflow uses `npm publish` directly.
The [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
describes these settings and requires npm >=11.5.1; our workflow uses Node 24 on a
GitHub-hosted runner. No long-lived npm token is needed for subsequent CI releases.

Dispatch **Publish shared npm packages** on `main`, selecting `next` for a
prerelease or `latest` for a stable version. The verification job runs full
`verify` and the bundle budget, then uploads the verified manifest/tarballs. The
publication job consumes those exact artifacts with `contents: read` and
`id-token: write`, validates their source commit and integrity, and publishes only
the three allowlisted packages. Public repository/package releases receive npm's
automatic provenance through trusted publishing; see
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

`verify:registry` downloads metadata and tarballs from HTTPS `registry.npmjs.org`
without following redirects, checks name/version and both registry/download
integrity against the verified release, then runs the same independent consumer
fixtures on the downloaded files. New-version 404s and temporary 5xx responses
receive at most ten attempts with bounded backoff; other failures stop immediately.
`.tmp/registry-shared-packages/verification.json`
is written only after all consumers pass. CI uploads publication and verification
receipts as release evidence.

Before choosing `latest`, validate the candidate in both applications, including
MB's independent checkout, production image, data migration and authenticated
profile. Create a new stable cohort with `version:shared`, update lockfiles and
repeat review/verification. A dist-tag is not a substitute for that validation.

## Local cross-repository development

### Upgrade an existing consumer to 0.1.7

Update all three dependencies together and keep their delivered versions exact:

```sh
npm pkg set "overrides.dompurify=^3.4.17"
npm install --ignore-scripts --save-exact @opendikw/web-client@0.1.7 @opendikw/web-ui@0.1.7 @opendikw/web-server@0.1.7
npm update dompurify zod --ignore-scripts
npm dedupe --ignore-scripts
npm ci --ignore-scripts
npm ls @mikro-orm/core @mikro-orm/sqlite @mikro-orm/sql dompurify zod
npm audit --omit=dev --audit-level=high
npm run verify
```

An existing lockfile can retain ADK's compatible-range core dependency at an
older version while the upgraded server and SQLite driver resolve to 7.2.5. Check the
actual ADK dependency tree after deduplication and the fresh strict install;
core, SQLite and SQL must all resolve to 7.2.5 before accepting this patch.
DOMPurify must resolve to at least 3.4.17 and Zod to at least 4.6.6. Keep the
existing override policy otherwise unchanged; a fresh strict install and audit
must pass before deployment.
Review and commit the exact registry manifest and regenerated lockfile together.
Do not bypass peer checks or rely on a previously installed node_modules tree.

### Test unreleased artifacts

Run `pack:shared`, then install its three tarballs together in a temporary MB
checkout to test an unreleased change. This installs compiled public artifacts
and tests package dependencies. Do not commit `file:`, workspace, sibling-source
or temporary-tarball dependencies in the private application. Its delivered
manifest and lockfile must reference the exact registry cohort. The shared
packages have no dependency on private MB code or credentials.

### Live session authorization (0.1.8)

`createWebRuntime({ validateSession })` accepts an optional server-only live
identity validator. It receives the issuer, client ID, subject, sealed access
token and immutable original signed login `iat`. Return the current viewer/editor
role; throw `SessionValidationError(401 | 403)` for revoked authorization, or
`SessionValidationError(503)` for unavailable identity status. Unknown errors
are treated as temporary failures. Tokens never enter browser responses.
Applications opting in must reject ambiguous provider status and validate the
provider response against their expected identity and application. Existing
sessions lacking access tokens/original authentication metadata require login.
Refresh preserves original authentication time. Temporary refresh or validation
failures return 503 without deleting cookies or sessions; confirmed invalid_grant
and revocation still end the local session. Live checks run on every protected
request, including requests before the idle renewal interval.
