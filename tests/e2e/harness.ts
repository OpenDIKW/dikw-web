import { test as base, expect } from "@playwright/test";

// Console gate: every e2e test fails if the page emits a `console.error` or an
// uncaught `pageerror`, turning "the console stayed clean" from a manual review
// step into a deterministic CI signal. Scope is intentionally narrow:
//   - only `console` messages of type `error` (not `warning` — React dev-mode
//     warnings are too noisy to gate on) and uncaught `pageerror`s.
//   - we do NOT listen to `requestfailed`/`response`, so mocked 4xx/5xx network
//     statuses are out of scope; only what actually reaches the JS console fails.
// Known intentional noise is allowlisted below. A test that deliberately drives
// an error path can opt out with `test.use({ consoleGuard: false })`.
const ALLOW: RegExp[] = [
  // Resource-load failures (failed fetch/img/script) are network-status, not JS,
  // errors and are out of this gate's scope. Chromium surfaces them as a generic
  // "Failed to load resource: ... 404" with no URL in the text, so they can't be
  // allowlisted by URL anyway. The suite intentionally 404s config.json on every
  // test (default-branding path) and a missing asset in markdown-assets; tests
  // that need a resource to load already assert the rendered outcome directly.
  /Failed to load resource/i,
  // User-initiated aborts: stop button, pause, effect cleanup. Not bugs.
  /AbortError/i,
  // Browser extension hint, never from app code.
  /Download the React DevTools/i,
];

const isAllowed = (text: string): boolean => ALLOW.some((re) => re.test(text));

export const test = base.extend<{ consoleGuard: boolean }>({
  consoleGuard: [true, { option: true }],
  page: async ({ page, consoleGuard }, use) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!isAllowed(text)) violations.push(`console.error: ${text}`);
    });
    page.on("pageerror", (error) => {
      // Same allowlist as console errors: an intentional AbortError surfacing as
      // an uncaught exception is still noise, not a regression.
      const text = error.message || String(error);
      if (!isAllowed(text)) violations.push(`pageerror: ${text}`);
    });

    await use(page);

    if (consoleGuard) {
      expect(violations, `expected a clean browser console, but saw:\n${violations.join("\n")}`).toEqual([]);
    }
  },
});

export { expect };
