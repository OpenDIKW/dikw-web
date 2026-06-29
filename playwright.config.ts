import { defineConfig, devices } from "@playwright/test";

const npmRun = process.platform === "win32" ? "npm.cmd run" : "npm run";

// Live integration mode (PLAYWRIGHT_LIVE=1): run ONLY tests/e2e/live/** against a
// real dikw-core via an already-running dev server (started by
// scripts/live-core/run.mjs on a dynamic port, passed as PW_LIVE_BASE_URL). The
// default mocked suite never runs the live specs (testIgnore below) and is
// otherwise unchanged. See docs/integration-verification.md.
const live = !!process.env.PLAYWRIGHT_LIVE;

export default defineConfig({
  testDir: live ? "./tests/e2e/live" : "./tests/e2e",
  // Keep the live specs out of the mocked suite (they need a real core).
  testIgnore: live ? undefined : ["**/live/**"],
  fullyParallel: true,
  reporter: "list",
  // CI-only retries, kept as a general backstop for timing-sensitive specs on
  // shared CI runners. The Pixi/StrictMode canvas race that previously made
  // `graph.spec.ts > renders a nonblank Pixi graph canvas` flaky is now fixed at
  // the source — GraphCanvas attaches the live engine's canvas only inside its
  // active guard, so a slower stale StrictMode init can no longer empty the mount.
  // Retries absorb residual environmental jitter without masking real regressions.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: live
      ? process.env.PW_LIVE_BASE_URL || "http://127.0.0.1:4321"
      : "http://127.0.0.1:4321",
    trace: "on-first-retry",
  },
  // In live mode the dev server is owned by the harness (dynamic port + proxy
  // target), so Playwright must not start its own.
  ...(live
    ? {}
    : {
        webServer: {
          command: `${npmRun} dev`,
          port: 4321,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: live ? "live" : "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
