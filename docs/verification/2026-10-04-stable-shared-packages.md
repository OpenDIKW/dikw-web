# Stable shared package preparation — 2026-10-04

The three public MIT packages retain the reviewed rc.2 runtime/API source and
move together to exact version 0.1.0, including internal and workbench manifest
dependencies. The application version is 0.11.3. This is preparation; stable npm
publication, registry consumers and private stable lockfile/image acceptance
remain pending. Public CI does not access private source or credentials.

Candidate rc.2 actually published through GitHub OIDC and passed registry byte
verification and independent consumers. The private bootstrap passed final-head
hosted CI and a clean independent registry clone. Real different-origin migration
preserved notes/aliases and target data without automatic Core writes. Real
authenticated production-container Core reader and SQLite/session backup/restart
passed after Debian security updates; private publication remains separately
tracked.

Gate review reproduced assertion loss across a Git rename, loss of declared
Vitest/Playwright discovery, explicit exclusions and nested coverage.exclude.
Original assertions and test deadlines remain unchanged. One strict Git
cat-file NUL batch replaces per-file process launches and malformed/error
responses fail closed. WSL Ubuntu 24.04 with Linux Node 24.21.0/Git 2.43.0 passed
all 41 targeted gate tests using the real repository Vite/jsdom configuration.
Native Windows runs have intermittent process-launch overruns; no deadline,
coverage floor, budget or retry was raised. Static config recognition is for
the declared literal discovery settings, not arbitrary configuration evaluation.

Three independent review passes resolved discovery/parser findings and accepted
the final complete diff. The complete local gate set passed: WSL Linux lint,
format, typecheck, full coverage (1288 tests in 104 files), build,
bundle, production high-severity audit and gate; Windows Chromium and independent
packed Node/React/production consumers passed against the same source hashes.
Chromium: 58 passed, two existing opt-in live-tool tests skipped, zero retries.
Entry/total JS/CSS: 278.0/1854.4/30.4 KB gzip within 280/1950/35 budgets.
The high-severity production audit passed with four existing moderate findings.
No test, timeout, coverage floor, budget or retry setting was weakened.

Local validation used both operating systems; it does not claim npm run verify
completed on a single local host. Additional WSL browser installation is optional
and is not a publication prerequisite. Hosted CI and the release workflow run
the unchanged complete npm run verify on Ubuntu. Final-head hosted CI, remote
review, stable publication and registry bytes remain pending.

Private security PR #2 merged at d7dc421af99ef17f5e43afed9d72012f122a9136;
its exact main CI run 37203240889 passed. Public MB business removal remains a
later change after stable private installation and final image acceptance.
