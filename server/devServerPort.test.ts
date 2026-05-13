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
    expect(playwrightConfig).toContain('baseURL: "http://127.0.0.1:4321"');
    expect(playwrightConfig).toContain("port: 4321");
    expect(playwrightConfig).toContain("reuseExistingServer: true");
    expect(playwrightConfig).not.toContain("5174");
    expect(playwrightConfig).not.toContain("5175");
  });
});
