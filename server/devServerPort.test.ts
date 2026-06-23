// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dev server port", () => {
  it("uses port 4321 for local Vite and Playwright e2e", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: { dev: string };
    };
    const playwrightConfig = readFileSync(join(root, "playwright.config.ts"), "utf8");

    expect(packageJson.scripts.dev).toContain("--port 4321");
    expect(packageJson.scripts.dev).toContain("--strictPort");
    // Default (mocked) mode pins 4321; live mode overrides baseURL via
    // PW_LIVE_BASE_URL (a dynamic port owned by the live harness), so the 4321
    // literal is now the default branch of the ternary rather than a bare value.
    expect(playwrightConfig).toContain('"http://127.0.0.1:4321"');
    expect(playwrightConfig).toContain("port: 4321");
    expect(playwrightConfig).toContain("reuseExistingServer: true");
    expect(playwrightConfig).not.toContain("5174");
    expect(playwrightConfig).not.toContain("5175");
  });
});
