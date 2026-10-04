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

Two independent generic-gate review passes resolved directory and direct-property
findings. Final release review, full verify, bundle/audit and hosted CI remain
pending for the complete stable preparation diff. Public MB business removal is
a later change after stable private installation and image acceptance.
