# Shared package release verification — 2026-10-03

This increment prepares a uniform `0.1.0-rc.1` candidate for the three MIT shared
packages. It adds an explicit artifact validator/publisher, registry verification,
cohort version updates and a manual trusted-publishing workflow. Existing public
CI already invokes independent package consumers through `npm run verify`.

## Evidence

- Validator/publisher/registry/version boundary tests: 4 files, 20 tests passed.
  Negative cases cover source dependencies/imports, missing declarations/CSS/fonts,
  undeclared dependencies, business/config/database/test files, cohort mismatch,
  modified tarballs, dirty/mismatched commits, conflicting registry versions/tags,
  partial release recovery and non-registry download URLs.
- Actual candidate packing found a regular-expression false positive on
  `/v1/import`. A failing behavior regression covering API paths, document text
  and comments preceded the TypeScript AST fix. Real package imports and declaration
  import types remain checked.
- Full local gate: lint, formatting, typecheck, 98 Vitest files / 1,248 tests;
  statements 77.31%, branches 67.76%, functions 77.44%, lines 79.08%.
  Windows coverage ran with one worker because earlier increments established
  native/concurrent resource effects; no timeouts or assertions were loosened.
- Production builds and 57 Playwright tests passed; two existing opt-in tests
  remain skipped. Bundle sizes: entry JS 277.4 KB, total JS 1,853.1 KB,
  CSS 30.4 KB gzip, all within unchanged budgets.
- All three actual `0.1.0-rc.1` tarballs passed independent OS-temporary-directory
  installs and consumers: client HTTP/NDJSON, strict declarations/public exports,
  isolated Node runtime HTTP/auth/SQLite persistence/shutdown without React/Vite,
  React/auth context, controls, reader hydration/fonts/CSS and optional Vite entry.
- Independent review checked the final AST validator, immutable publication,
  recovery, registry host/integrity restrictions, workflow permissions/artifact
  handoff and project review rubric. No actionable findings; reviewer reran all
  20 boundary tests. Final implementation self-review also found no unresolved
  correctness issue.
- Remote review subsequently identified dirty-pack/restore provenance and
  immediate registry lookup issues. Three additional failing regressions preceded
  the fixes; all 23 release-boundary tests now pass. Manifests record source
  cleanliness at packing time; the publisher rejects dirty or missing provenance,
  even after restoring the current checkout. Packing clears verified package-owned
  output before compilation. Registry 404/5xx responses receive at most ten
  attempts with bounded backoff, while permanent failures remain immediate.
  The second independent review is clean; lint, formatting and all three rebuilt
  candidate tarball consumers passed again. Initial CI's full Verify, image,
  dependency, secret and CodeQL checks passed; the expected workflow gate awaits
  the maintainer decision.

## Workflow gate and external prerequisites

The private candidate's real development-browser pass found that canonicalizing
all paths changed `/@vite/client` and scoped-package resource spelling. The MB
guard now canonicalizes dispatch only within its API namespaces, while validating
every request against the unchanged capability policy. A failing real Vite HTTP
regression preceded the fix; Vite JavaScript and an `@` resource now load, and
all 65 profile/integration cases pass. The rebuilt cohort was installed into the
independent MB application again and its root now renders against the real Core.
The final complete local verification passed: 98 Vitest files / 1,251 tests,
57 browser tests with the two existing skips, lint, formatting, typecheck, builds
and all three rebuilt independent package consumers. The unchanged bundle budgets
passed again. The third and final independent review found no actionable issue.

The maintainer explicitly approved `gate-change` for PR #216 on 2026-10-03;
the label has been applied. CI and review still gate the final merge.

Adding `.github/workflows/publish-packages.yml` intentionally triggers
`gate-machinery-modified`. It adds a release workflow; existing CI checks,
coverage thresholds, bundle budgets and browser retry/assertion policies are
unchanged. Per the existing delivery workflow, a maintainer must review the
concrete PR and add `gate-change`; the implementation does not set a local
override or alter the gate.

Update on 2026-10-04: PR #216 is merged. The owner completed npm login and 2FA;
all three `0.1.0-rc.1` packages were published under `next` from the clean reviewed
commit `7ae8fcc5a4919053c1acb84fb8fc4e04b5627160`. Registry metadata, downloaded
tarball SHA-512 integrity and independent Node/React/production consumers passed.
The owner authorized the three Trusted Publisher connections, and each npm Settings
page confirmed GitHub repository `OpenDIKW/dikw-web`, `publish-packages.yml`, blank
environment and npm publish permission. Actual GitHub OIDC publication subsequently created all three rc.2 packages
from reviewed commit 8e67238f6e66ecd741fed5f26f5a9e5ec4810578. Registry-byte
verification and independent consumers passed in run 37178344897; an initial
propagation 404 was followed by idempotent verification of identical published
bytes. This is evidence of publication of a new cohort, not only skipping an
already-existing version.
Stable publication and public MB removal remain gated on private application and
image acceptance. Credentials and account verification screenshots are not committed.

`OpenDIKW/dikw-mbweb` has been created and its visibility verified as Private.
Its sibling checkout has an independent history and migration provenance; source
implementation continues there. No private source or credentials enter public CI
or the shared tarballs.
