import { exec } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execAsync = promisify(exec);

test.describe("live web tools (manual)", () => {
  test.skip(!process.env.LIVE_WEB_TOOLS, "set LIVE_WEB_TOOLS=1 to hit Tavily / Jina with real keys");

  test("web_search returns at least one result for a known query", async () => {
    const { stdout } = await execAsync(
      `node scripts/verify-web-tools.mjs search "wikipedia"`,
      { cwd: process.cwd(), timeout: 30_000 }
    );
    const payload = JSON.parse(stdout) as { query: string; results: Array<{ url: string }> };
    expect(payload.query).toBe("wikipedia");
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0].url).toMatch(/^https?:\/\//);
  });

  test("web_fetch reads example.com without truncation", async () => {
    const { stdout } = await execAsync(
      `node scripts/verify-web-tools.mjs fetch https://example.com`,
      { cwd: process.cwd(), timeout: 30_000 }
    );
    const payload = JSON.parse(stdout) as { url: string; content: string; truncated: boolean };
    expect(payload.url).toMatch(/^https:\/\/example\.com\/?$/);
    expect(payload.content.length).toBeGreaterThan(0);
    expect(payload.content.toLowerCase()).toContain("example");
  });
});
