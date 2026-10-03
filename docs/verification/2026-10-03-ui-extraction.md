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

Chrome DevTools MCP is unavailable in this session. Google Chrome's official
Lighthouse CLI is used for comparable light/dark Base and Settings audits.
The initial Base/light result is accessibility 0.92 and CLS 0.00445; complete
comparison results are recorded before merge.

The independent reviewer found missing shared field focus rules and unreachable
CSS declarations. Both were fixed and validated in the external consumer.
The final review independently compiled all eight entries and had no findings.

This increment does not publish to npm or move MB business code. Docker Desktop
still does not answer its local engine API; real Casdoor and production image
execution remain part of the later deployment verification.
