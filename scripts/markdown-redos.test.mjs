// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A separate process can be killed even when a synchronous parser blocks its
// event loop. These sizes leave ample headroom for linear scans on CI runners.
describe("untrusted Markdown parsing has a bounded execution time", () => {
  it.each([
    [
      "standard images",
      `extractAssetRefs("![\\\\".repeat(60000)); extractAssetRefs("![](" + " ".repeat(120000) + "x"); extractAssetRefs("![](x".repeat(60000) + "\\n)");`,
    ],
    [
      "Obsidian images",
      `extractAssetRefs("![[\\\\".repeat(60000)); extractAssetRefs("![[\\\\|\\\\".repeat(60000));`,
    ],
    [
      "heading wikilinks",
      `slugifyHeading("[[\\\\".repeat(60000)); slugifyHeading("[[\\\\|\\\\".repeat(60000));`,
    ],
    [
      "details blocks",
      `const body = "<details><summary>" + "</summary>a".repeat(60000); body.replace(rawDetailsPattern, ""); splitMarkdownBlocks(body); ("<details ".repeat(60000) + ">" + " ".repeat(120000) + "<summary>x</summary>y</details>").replace(rawDetailsPattern, "");`,
    ],
    [
      "chart whitespace",
      `const body = " ".repeat(120000) + "x"; for (let i = 0; i < 1000; i++) parseChartFromDetails(body, "bar");`,
    ],
  ])("finishes %s without blocking", (_name, operation) => {
    const code = `
      import { extractAssetRefs } from "@opendikw/web-client/import";
      import { rawDetailsPattern, slugifyHeading, splitMarkdownBlocks } from "@opendikw/web-client/document";
      import { parseChartFromDetails } from "./packages/web-ui/dist/reader/chart-spec.js";
      ${operation}
      console.log("completed");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      timeout: 3000,
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("completed");
  });
});
