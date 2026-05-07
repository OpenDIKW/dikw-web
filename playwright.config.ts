import { defineConfig, devices } from "@playwright/test";

const npmRun = process.platform === "win32" ? "npm.cmd run" : "npm run";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5175",
    trace: "on-first-retry"
  },
  webServer: {
    command: `${npmRun} dev -- --port 5175 --strictPort`,
    port: 5175,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
