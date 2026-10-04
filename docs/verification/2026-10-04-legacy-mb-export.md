# Legacy MB export verification — 2026-10-04

The old MB application remains available at #MB-Web. Its header now explicitly
exports notes and paper aliases as dikw-mbweb-migration.json. The exporter reads
only the two fixed legacy keys, preserves their bytes, and excludes credentials,
connection settings and caches. Malformed data is reported without overwriting it.
The future limited migration page and safe deployment URL are prepared but are
not mounted until the private application passes registry, CI and image acceptance.

## Deterministic verification

- Final lint, formatting, strict typecheck, production browser/server build and
  gate-integrity passed. The root version and changelog are 0.11.1.
- Full coverage: 103 files / 1,266 tests passed; statements 77.40%, branches 67.97%,
  functions 77.46%, lines 79.19%. Original floors remain 60/45/55/60.
- Windows first encountered a native worker failure, then two unchanged test
  timeouts under concurrent verification load. Each affected file passed alone;
  the final entire suite passed with one worker. Assertions, test timeouts and
  coverage/CI configuration were not changed.
- Full Chromium suite: 58 passed; two existing opt-in live web-tool cases skipped,
  with no added skips or retry changes. The migration download flow checks the
  filename, schema, notes/aliases, excluded credentials and original storage bytes.
- Final gzip: entry JS 278.0 KB, all JS 1,854.3 KB, CSS 30.4 KB; original ceilings
  remain 280/1950/35 KB.
- Actual tarball consumers for client, React UI and standalone server passed in
  the final full gate after the review fixes, each from an independent install.
  The shared package source is unchanged; hosted CI checks the final commit again.
- Three independent read-only reviews completed. The first found that the old pages
  could overwrite malformed storage before export. Seven failing page-level cases
  reproduced this and now preserve original bytes while keeping export available.
  The second review found no remaining actionable issue. Remote review then found
  immediate Blob URL revocation and the damaged-note branch hiding paper research.
  Both were reproduced with failing regressions before fixes. Downloads now keep
  the URL alive for a later browser task and release it after one second; damaged
  notes preserve original bytes and block note/Wisdom writes while research stays
  usable. The third independent review passed; final self-review checked the
  delivery rubric and documented the remaining deployment prerequisites.

## Real browser and migration evidence

An isolated Core 0.6.8 served the shared reader fixture. The old header/export,
paper alias, notes and reading were inspected in both themes. A fresh reload had
no runtime console warnings/errors; transient development hot-reload createRoot
messages were observed before that reload while package builds were changing.

An opt-in Chromium test ran at two different loopback origins without API mocks:
download from the actual old app, explicitly import the same file twice into the
independent MB app, read real Core content, reload, preserve the alias and notes,
retain old storage bytes, and verify migration made no Core POST. The committed
private test fixture and README describe how to reproduce its CLI import/indexing.
The live flow passed again after the final review fixes on freshly restarted apps.

The official installed Chrome/Lighthouse CLI measured the legacy route in both
themes and saved its performance traces (the DevTools MCP audit tool is unavailable
in this environment). Accessibility was 0.96 in each theme; CLS was 0.000433.
LCP was 2,585 ms light and 2,127 ms dark. The inherited muted-text contrast findings
match the independent app's unchanged research chrome, and the export control adds
no contrast finding. Optional config.json 404s are expected deployment fallback;
no application console exception appeared on the clean reload.

The new application's private repository and exact package declarations were
checked independently. npm login as helebest, organization ownership and
authenticated publish dry-run passed. Actual publication was rejected with E403
because account 2FA is required. First registry publication and registry lockfile,
private hosted CI and registry-built/scanned image remain pending. Actual Casdoor
and host-process BFF verification is additional evidence, not container acceptance.
The isolated Core is loopback with authentication disabled, so Core token
enforcement, IdP SSO/logout and full backup/image rollback are still unverified.
These prerequisites prevent switching the old hash or deleting public MB pages.

Local fixture credentials, cookies, storage exports and browser images are ignored
verification artifacts, not committed source or customer data.
