# Immutable paper evidence scope — 2026-10-04

The maintainer selected current-paper Q&A by default, with an explicit separate
cross-paper entry. A local title is a display alias; the canonical Core path is
the evidence boundary. This feature does not add per-user content authorization
to the shared Core knowledge base.

## Behavior and review

Session creation accepts optional `scope.pagePath`. The owned SQLite session
persists it, including across reopening and renaming. Message bodies cannot
override it. Scoped sessions expose only health and `read_page`, reject another
path before contacting Core, and reject a mismatched Core response. Successful
page reads emit citations. Existing no-body session creation remains compatible.

The ADK instruction provider preserves literal brace-containing filenames. Two
real Runner/SQLite regressions first demonstrated ADK state interpolation, then
passed for `sources/{paper}/article.md` and `sources/{title}.md` after the fix.

Two independent read-only review passes checked the server boundary and release
cohort. The first found literal-path interpolation and an unbracketed changelog
heading. Both were reproduced and fixed; the second pass reported no actionable
findings. Final self-review against `docs/review-rubric.md` found no unresolved
finding. Runtime relative imports retain `.js`, and no verification configuration
or required workflow changed.

## Verification

The exclusive full coverage gate passed: 104 files / 1,273 tests, no unhandled
worker error. Coverage was 77.40% statements, 68.02% branches, 77.46% functions and
79.19% lines, above the unchanged 60/45/55/60 floors. Lint, formatting, strict types, production browser/server builds, all 58 Chromium
flows and independent Node/React/production package consumers passed. Two existing
opt-in external-service flows were skipped. Local browser retries stayed at zero.
The bundle and gate checks passed; exact gzip figures are recorded in the PR.

Earlier local full runs did not pass: default parallelism encountered three
existing five-second timeouts; a serial run recorded a Windows native worker
fail-fast; the next recorded a worker-start handshake timeout before test
execution. A fresh read-only diagnosis confirmed all 87 page tests and all 43
auth tests pass individually with the original V8 coverage configuration. The
single-file commands still fail global coverage floors, as expected for partial
coverage; they are not substitutes for a complete passing gate. An owned,
completed migration Vite service with high accumulated CPU was stopped before
one final exclusive run. Its causal contribution remains unproven.

## Independent application and actual model

A temporary MB checkout outside both repositories installed SHA-512-verified
rc.2 tarballs, with no sibling source imports. Lint, format, strict types,
production builds, 23 files / 102 tests and seven Chromium flows passed. Coverage
was 68.05/59.09/66.55/71.13; gzip was 219.5/1501.5/16.7 KB against unchanged
280/1950/35 ceilings. This is development artifact acceptance, not registry rc.2
installation or private-image acceptance.

CUA exercised the actual isolated Core 0.6.8 and configured model. After a local
rename, Q&A correctly answered the fixture's component ownership table. The
persisted session had scope and source `sources/shared-reader.md`, only
`read_page`, two messages and no proposals. The separate cross-paper history and
return to paper history were verified in the actual UI. Light/dark rendering and
a clean console passed. Private UI accessibility/performance evidence belongs
to its own repository. No real Wisdom write was performed in this pass.

## Release boundary

The cohort advances to `0.1.0-rc.2`. All three npm Trusted Publishers are configured
for `OpenDIKW/dikw-web`, workflow `publish-packages.yml`, blank environment and
publish permission, following owner approval and completed 2FA. Actual new-version
GitHub OIDC publication and registry acceptance remain pending until merge and
successful workflow dispatch. Stable publication and public MB removal remain
gated on private application and image acceptance.
