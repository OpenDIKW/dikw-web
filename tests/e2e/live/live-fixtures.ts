import { test as base, expect } from "../harness";

// Live-mode fixtures. Reuses the harness `test` (console gate intact) and adds
// an auto fixture that seeds the connection into localStorage BEFORE any
// navigation: serverUrl = the canonical default so the browser uses the
// same-origin Vite proxy (core has no CORS), and the proxy forwards to the real
// core via VITE_DIKW_PROXY_TARGET (set by scripts/live-core/run.mjs). The token
// is passed through PW_LIVE_TOKEN. See docs/integration-verification.md.

// Must equal defaultServerUrl in src/config/connection.ts so App.tsx routes /v1
// through the proxy (clientBaseUrl === "" path) instead of a direct fetch.
const DEFAULT_SERVER_URL = "http://127.0.0.1:8765";

export const test = base.extend<{ seedConnection: void }>({
  seedConnection: [
    async ({ page }, use) => {
      await page.addInitScript(
        ({ url, token }) => {
          localStorage.setItem("dikw-web.serverUrl", url);
          if (token) localStorage.setItem("dikw-web.token", token);
        },
        { url: DEFAULT_SERVER_URL, token: process.env.PW_LIVE_TOKEN || "" },
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
