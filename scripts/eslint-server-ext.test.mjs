// @vitest-environment node
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("dikw/server-relative-js-extension lint rule", () => {
  const eslint = new ESLint();

  it("rejects relative imports and exports without .js in server/** runtime modules", async () => {
    const code = [
      'import { a } from "./workbenchHandler";',
      'export { b } from "../auth/casdoor";',
      'export * from "./helpers";',
      'export * from ".";',
      'import c from "..";',
      'export const load = () => import("./lazy");',
      "export const loadTpl = () => import(`./lazyTpl`);",
      "export const ok = a + b + Number(Boolean(c));",
    ].join("\n");
    const [result] = await eslint.lintText(code, { filePath: "server/agent/example.ts" });
    const ruleHits = result.messages.filter(
      (m) => m.ruleId === "dikw/server-relative-js-extension",
    );
    expect(ruleHits).toHaveLength(7);
  });

  it("accepts explicit .js extensions, bare package imports, and *.test.ts files", async () => {
    const runtimeCode = [
      'import { createServer } from "node:http";',
      'import { createWorkbenchHandler } from "./workbenchHandler.js";',
      'export { casdoorEnvironment } from "../auth/casdoor.js";',
      "export const loadTpl = () => import(`./lazyTpl.js`);",
      "export const refs = [createServer, createWorkbenchHandler];",
    ].join("\n");
    const [runtimeResult] = await eslint.lintText(runtimeCode, {
      filePath: "server/agent/example.ts",
    });
    expect(
      runtimeResult.messages.filter((m) => m.ruleId === "dikw/server-relative-js-extension"),
    ).toEqual([]);

    const testCode =
      'import { createWorkbenchHandler } from "./workbenchHandler";\nvoid createWorkbenchHandler;\n';
    const [testResult] = await eslint.lintText(testCode, {
      filePath: "server/agent/example.test.ts",
    });
    expect(
      testResult.messages.filter((m) => m.ruleId === "dikw/server-relative-js-extension"),
    ).toEqual([]);
  });
});
