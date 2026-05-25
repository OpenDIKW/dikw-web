// Standalone Playwright config for manual smoke tests.
// Run:  npx playwright test --config=tests/manual/playwright.config.ts --headed --workers=1
//
// Excluded from CI by living outside ./tests/e2e (the default testDir).
import { defineConfig, devices } from "@playwright/test";

const npmRun = process.platform === "win32" ? "npm.cmd run" : "npm run";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  reporter: "list",
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `${npmRun} dev`,
    port: 4321,
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
