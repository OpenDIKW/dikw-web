import { defineConfig, devices } from "@playwright/test";

const npmRun = process.platform === "win32" ? "npm.cmd run" : "npm run";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry"
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
