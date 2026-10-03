# Shared UI extraction verification

The second split increment adds the MIT-licensed `@opendikw/web-ui` package.
Both existing applications consume its controls, reader, hooks, authentication
context and theme mechanism through compiled public entries. Business models,
navigation, translated copy and application layouts remain in the applications.

## Deterministic checks

- All existing assertions in the ten moved UI test files are retained. The
  [migration manifest](mbweb-test-migration.json) records the destinations.
- 89 Vitest files / 1,145 tests passed, with coverage 77.38% statements, 67.40%
  branches, 77.17% functions and 79.23% lines. Thresholds remain 60/45/55/60.
  The final local coverage run used two workers after the default concurrent
  run exposed an existing async assertion race. That assertion now waits for
  loaded session content; the unsafe-link checks are unchanged.
- 57 Playwright tests passed; two existing opt-in live cases remain skipped.
  The four Graph tests also passed in headed Chromium.
- Lint, formatting, typecheck, browser/server builds and gate integrity passed.
- Bundle gzip: entry JS 277.4 KB / 280 KB, total JS 1,852.9 KB / 1,950 KB,
  CSS 30.4 KB / 35 KB.
- An installation outside the repository consumes actual tarballs with its
  own React, React DOM, Vite and React declarations. It verifies shared Context
  permissions, keyboard focus styling, Markdown, KaTeX fonts, lazy Mermaid and
  ECharts, authenticated image requests, and theme switching. A controls-only
  build excludes reader and Node dependencies.
- Each of the five UI entries and three CSS exports compiles in a separate
  strict TypeScript 6 / NodeNext program with `skipLibCheck: false`.

## Browser and review

An isolated real dikw-core 0.6.8 process serves a temporary SQLite base on
localhost. Its test source was indexed with embeddings disabled. The workbench
Base reader renders its headings, table, math and Mermaid in light and dark;
Settings theme selection applies immediately. No new console errors appeared
after a stable reload. Rebuilding package output while Vite was open produced
existing Fast Refresh/createRoot warnings; these are development reload behavior,
not failures in the packed production consumer.
The existing MB application also renders the same real source in both themes;
its paper library, three-column reader and notes view retain their layout.

Chrome DevTools MCP is unavailable in this session. Google Chrome's official
Lighthouse CLI is used for comparable light/dark Base and Settings audits.
The baseline is main commit `f245ec4`, served with the same Core connection,
translation availability and font access. The results are:

| Page / theme | Baseline accessibility | Extracted accessibility | Baseline CLS | Extracted CLS |
| --- | ---: | ---: | ---: | ---: |
| Base / light | 0.92 | 0.92 | 0.00310 | 0.00445 |
| Base / dark | 0.95 | 0.95 | 0.00042 | 0.00310 |
| Settings / light | 1.00 | 1.00 | 0.00010 | 0.00010 |
| Settings / dark | 1.00 | 1.00 | 0.00010 | 0.00010 |

All accessibility scores exceed 0.90 and CLS remains below 0.10. Base's existing
tab-list role, contrast and accessible-name findings are identical on main.
Development-server LCP is 12.9–14.0 seconds, versus 11.9–14.7 seconds on main;
this soft measurement is recorded without claiming production performance.

The independent reviewer found missing shared field focus rules and unreachable
CSS declarations. Both were fixed and validated in the external consumer.
The final review independently compiled all eight entries and had no findings.
CodeRabbit additionally found preference leakage when a consumer changes its
theme storage key. A failing regression reproduced it; the hook now reloads the
new key and validates its value. Auth tests also reject numeric issuer/coreId.
The focused follow-up run passes 22 tests. Public auth-provider and trusted
asset-configuration obligations are documented in the package README.

This increment does not publish to npm or move MB business code. Docker Desktop
still does not answer its local engine API; real Casdoor and production image
execution remain part of the later deployment verification.
