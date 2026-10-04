# Public application cutover — 2026-10-05

The public application moves to `0.12.0`. Its former `src/mb` business
implementation is removed after independent private installation, CI, image
publication and runtime acceptance. The three MIT shared packages remain at the
already published exact `0.1.0`; this change neither republishes them nor changes
their runtime/API source.

## Application and test boundary

The management workbench remains the default entry. Case-insensitive `#MB-Web`
and `#/mb-web` open a lazy Chinese notice with an explicit read-only backup of
the two legacy notes/aliases keys. Initial legacy entry does not probe auth.
Switching between the two entry types replaces the browser document, preventing
pending workbench auth probes and the installed global 401 handler from affecting
the backup page. Ordinary workbench hash navigation remains inside the SPA.
Returning to the workbench still performs its normal fail-closed auth probe.

The maintainer retired private Settings/import/export in private PR #6. The public
notice therefore offers a local backup, preserves raw source bytes and makes no
promise of a private import entry. Destination URLs are fixed validated HTTP(S)
URLs; the old query/fragment is never forwarded.

Build checks reject the finite former business paths/components in source,
static assets, emitted modules and sourcemap sources, including maps copied from
`public/`. Generic design assets, shared readers/profiles and the migration
protocol remain public. Empty untracked directories do not represent shipped
source. Eight real Vite fixtures cover the boundary, including positive shared
code, directly copied static maps and directory symbolic links. The two link
fixtures reproduced a real private-byte copy before the scanner rejected links.

The [transfer ledger](mbweb-test-migration.json) records each removed business
test and the partial MB typography scenario against private main
`701fdbf3a2b2e544d2e0d4d8a8ba9932153bffb9`. Original damaged-notes assertions
were reproduced red and fixed in the private application; original legacy backup
damage assertions remain in the public migration component tests. Application
storage key changes and the maintainer's explicit retirement of private Settings
are documented exceptions. Coverage/discovery settings, deadlines, retries and
bundle limits are unchanged. The local gate detects seven removed test files and
two transferred typography assertions; their acceptance requires the visible
authorized `gate-change` label, rather than a local hidden override.

Three independent local review rounds resolved pending-probe navigation and
static copied-map findings. The final round found no remaining actionable issue.
A subsequent real dark-theme audit found the existing primary button's contrast
insufficient; the notice now uses the existing secondary variant. No shared
stylesheet or published package was modified for that correction.

## Local deterministic verification

An independent WSL Ubuntu 24.04 checkout and `npm ci --ignore-scripts` run all
verification stages with Node 24.21.0. Coverage uses one worker and Playwright
uses two; original deadlines and retry policy remain intact. Both the first
complete run and final source verification after the button contrast correction
passed 1296 tests in 98 files, 62 Chromium flows, the three independently
installed packed consumers and bundle checks. Two existing opt-in live flows
remain disabled. These results belong to the initial cutover, before the remote
review corrections described below.

Remote PR review subsequently reproduced an unnecessary sequential startup:
branding could add two seconds before the workbench auth probe began. Root now
mounts immediately and starts workbench authentication concurrently with its
single startup branding request, while waiting for both results before rendering
the authenticated workbench. Legacy entry still makes no auth probe. A new
browser-clock-controlled regression holds branding and freezes its timeout; it
failed with zero auth requests on the old code and passes on the correction.
Full verification of the concurrent startup correction passed 1296 tests and
63 browser flows. Final whole-source verification, including the native hosting
and symbolic-link corrections, passed 1302 tests in 99 files, 63 browser flows,
all three independent packed consumers, lint, formatting, typecheck, build,
bundle budgets and the production high/critical audit. The final snapshot started
at `2026-10-04T18:00:24Z` and completed at `2026-10-04T18:05:18Z`; code file
hashes were checked before committing. Subsequent edits only synchronize this
verification record and the implementation plan.

Remote review also identified that the shared runtime's authentication gate
prevented anonymous browsers from loading the notice's initial HTML. The public
application now owns a native hosting adapter for its built HTML, recognized
assets/fonts/root images and non-secret branding config. API requests, writes,
unknown files and source maps still use the shared authentication gate; symbolic
links are rejected. The shared runtime and the private application's hosting
policy remain unchanged. Real HTTP tests reproduce the unsigned-shell failure
and verify unavailable-IdP boot, protected APIs/writes, link/traversal rejection
and missing public assets returning 404 without an authentication challenge.
The authenticated Vite development adapter retains its existing gate.

The final recorded coverage is statements 82.89%, branches 73.72%, functions 86.44%
and lines 84.21%, against unchanged floors 60/45/55/60. Entry/total JS/CSS gzip
is 265.5/1843.1/27.0 KB in the final verification, against unchanged
280/1950/35 KB budgets. Production
high/critical audit passed; four existing moderate findings remain in the lockfile.
Hosted CI must additionally run the literal `npm run verify` and image/secret scans
on the final PR head before merge.

## Actual browser and Core checks

The verified production UI is served by the actual built native standalone on
an owned loopback listener, including its application-owned public hosting adapter
and real `/web`, `/agent` and `/v1` runtime handlers. It uses real Casdoor 3.152.0
login and the token-protected Core 0.6.8 SQLite base; no static proxy or mocked HTTP
response is used. Earlier proxy-based checks were insufficient to verify the
anonymous native boot and were replaced by these direct checks. Before replacing
the owned workbench process, both original SQLite databases were backed up online
and passed `quick_check`. Native browser verification uses a separate owned data
directory. After verification, the final built standalone was restarted on the
original data directory. Both original databases again passed read-only
`quick_check`; actual Casdoor login and authenticated Core access passed on the
restored data. Final anonymous GET/HEAD missing-file checks return 404, the shell
returns 200, protected APIs return 401 and the legacy notice makes no auth probe.
Chrome and Lighthouse CLI are used because the named DevTools MCP audit tools are
not available in this session. Lighthouse saves the actual trace and DevTools log
alongside each report.

Actual checks passed: anonymous legacy entry without auth probes; explicit local
backup with credentials excluded and source bytes preserved; real login and Core
overview; `sources/shared-reader.md` table, KaTeX and Mermaid; light/dark rendering
at 1440 and 390 pixels without horizontal overflow; workbench-to-legacy document
replacement; zero app console errors. The read-only live contract smoke passes
all seven consumed endpoints/shapes.

| Route | Theme | Accessibility | Best practices | CLS | LCP (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Legacy notice | Light | 100 | 96 | 0.0237 | 549.471 |
| Legacy notice | Dark | 100 | 96 | 0.0237 | 519.563 |
| Workbench overview | Light | 100 | 96 | 0.0071 | 395.632 |
| Workbench overview | Dark | 100 | 96 | 0.0099 | 286.485 |

There are no failing accessibility audits in these final reports. CLS remains
below 0.1. LCP is recorded as a local soft measurement, with the full deterministic
verification performed separately; timings across different runners/build modes
are not treated as a causal comparison. The owned test Chrome context is closed
after verification; the private preview remains closed.

## Independent private delivery

[Private PR #7](https://github.com/OpenDIKW/dikw-mbweb/pull/7) merged as
`701fdbf3a2b2e544d2e0d4d8a8ba9932153bffb9`, application `0.1.4`, shared
dependencies exact `0.1.0`. [Exact main CI](https://github.com/OpenDIKW/dikw-mbweb/actions/runs/37218183657)
and [publication](https://github.com/OpenDIKW/dikw-mbweb/actions/runs/37218360516)
passed. The accepted private image is
`ghcr.io/opendikw/dikw-mbweb@sha256:68c2f573087469a5c34780cb56d2a92f1c02408acb2f7ab0f23c96de9620de42`.

[Permanent runtime evidence](https://github.com/OpenDIKW/dikw-mbweb/pull/7#issuecomment-5982327255)
records independent registry pull, private repository/package association, OCI
source/revision and non-root user, real login/Core reader, both damaged-storage
cases, offline SQLite integrity/backup, same-volume restart and actual rollback
to published `0.1.3` followed by restoration of the new digest. Private validation
passes 145 tests and 10 browser flows. The new release does not claim a fresh
provider-backed Q&A run; earlier actual MiniMax Q&A/translation evidence remains
historical.

## Outstanding integration scope

The complete real Core import → ingest → synth pipeline has not passed. The
isolated Core lacks provider credentials; the service associated with the existing
legacy embedding key requires confirmation before sending that key to a provider.
This is tracked separately from the green read contract, actual reader and private
Wisdom persistence/archive checks. Public PR CI/review/merge and main release are
also pending at the time this record is prepared. Neither fixtures nor old receipts
are counted as those missing acceptance results.
