import { defineConfig, devices } from "@playwright/test";

const npmRun = process.platform === "win32" ? "npm.cmd run" : "npm run";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  // CI-only retries to absorb a documented Pixi/StrictMode race in
  // `graph.spec.ts > renders a nonblank Pixi graph canvas`: the
  // create-pixi -> destroy -> recreate cycle from React StrictMode dev mode
  // can leave the canvas mount empty after `data-ready=true` flips. Locally
  // the test usually passes on the first attempt; CI runners (headless
  // chromium on Ubuntu) hit it more reliably. Two retries empirically
  // absorb every observed occurrence without masking actual regressions —
  // the test is fast (~10s) and unrelated to this codebase's logic.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry",
  },
  webServer: {
    command: `${npmRun} dev`,
    port: 4321,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
