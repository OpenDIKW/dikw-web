// @vitest-environment node
import { expect, it } from "vitest";
import { createDikwTools } from "../agent/adkTools.js";
import { systemPrompt } from "../agent/runtime.js";

it("registers only knowledge tools and configured external tools for MB", () => {
  const options = { coreUrl: "http://127.0.0.1:9", profile: "mbweb" } as const;
  const tools = createDikwTools(options).map((tool) => tool.name);
  expect(tools).toContain("retrieve_knowledge");
  expect(tools).toContain("read_page");
  expect(tools).not.toContain("propose_maintenance_action");
  expect(tools).not.toContain("web_search");
  expect(tools).not.toContain("web_fetch");
  expect(
    createDikwTools({ ...options, tavilyApiKey: "fixture", jinaApiKey: "fixture" }).map(
      (tool) => tool.name,
    ),
  ).toEqual([...tools, "web_search", "web_fetch"]);
  expect(systemPrompt("mbweb")).not.toContain("maintenance");
});
