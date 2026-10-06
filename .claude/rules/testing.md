---
paths:
  - "tests/**"
  - "src/test/**"
  - "playwright.config.ts"
  - "docs/tdd.md"
  - "docs/ui-checklist.md"
---

# Testing approach

Read this rule before you add or change tests, the e2e harness, or the live verification scripts.

TDD for behavior changes: failing test first, smallest change to green, then refactor. Page/component tests for visible behavior; API-boundary tests for client/sidecar contracts. Playwright covers route compatibility, i18n chrome, dark contrast, markdown rendering, chat layout, and graph interactions. Every e2e spec imports `test`/`expect` from `tests/e2e/harness.ts` (not `@playwright/test` directly), which adds a **console gate** — any `console.error` or uncaught `pageerror` fails the test (resource-load 404s, `AbortError`, and the React DevTools install hint are allowlisted; a test that deliberately drives an error path opts out with `test.use({ consoleGuard: false })`). `src/test/setup.ts` is the Vitest setup file; `jsdom` is the test environment. Qualitative UI rules (single-language chrome, dark reader contrast, small radii, no UI framework, graph filters) that aren't fully gated live as a pass/fail rubric in `docs/ui-checklist.md`, run by the `dikw-web-verify-frontend` skill. Because the e2e suite mocks `/v1` and can't see real contract drift, `npm.cmd run smoke:core` (`scripts/smoke-core.mjs`, the `dikw-web-smoke-core` skill) asserts the consumed `/v1` contract against a live core — run it after a `dikw-core` bump or before a demo; it is not a CI gate. For a fuller end-to-end pass, `npm.cmd run live:verify` boots a **real `dikw-core`** (GHCR image + Postgres, dynamic ports) and runs the write pipeline + read smoke + a `live` Playwright project + an agent↔core check against it (see `docs/integration-verification.md`); also not a CI gate (it boots a container and calls live LLMs — `live-integration.yml` runs it on dispatch/nightly/label). `tests/e2e/perf.spec.ts` asserts a Cumulative Layout Shift budget (≤ 0.1) on the primary routes — the one Core Web Vital stable under headless Chromium; LCP and long-task totals are surfaced as annotations but not gated (runner-dependent timing). ESLint (`npm.cmd run lint`, flat config, `--max-warnings 0`) and Prettier (`format:check`, code only) run as part of `verify`.
