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

```sh
npm run version:shared -- 0.1.4
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

### Upgrade an existing consumer to 0.1.3

Update all three dependencies together and keep their delivered versions exact:

```sh
npm install --save-exact @opendikw/web-client@0.1.3 @opendikw/web-ui@0.1.3 @opendikw/web-server@0.1.3
npm dedupe
npm ci --ignore-scripts
npm ls @mikro-orm/core @mikro-orm/sqlite @mikro-orm/sql
npm run verify
```

An existing 0.1.0 lockfile can retain ADK's compatible-range core dependency at
7.2.1 while the upgraded server and SQLite driver resolve to 7.2.3. Check the
actual ADK dependency tree after deduplication and the fresh strict install;
core, SQLite and SQL must all resolve to 7.2.3 before accepting this patch.
Review and commit the exact registry manifest and regenerated lockfile together.
Do not bypass peer checks or rely on a previously installed node_modules tree.

### Test unreleased artifacts

Run `pack:shared`, then install its three tarballs together in a temporary MB
checkout to test an unreleased change. This installs compiled public artifacts
and tests package dependencies. Do not commit `file:`, workspace, sibling-source
or temporary-tarball dependencies in the private application. Its delivered
manifest and lockfile must reference the exact registry cohort. The shared
packages have no dependency on private MB code or credentials.
