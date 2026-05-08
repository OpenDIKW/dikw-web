import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("reads a wiki page and follows a wikilink", async ({ page }) => {
  await page.goto("/#wiki");

  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Knowledge directory" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "concepts" })).toBeVisible();
  await expect(page.getByText("Layered DIKW notes.")).toBeVisible();

  const reader = page.getByRole("main", { name: "Wiki reader" });
  await reader.getByRole("button", { name: "Synthesis", exact: true }).click();

  const preview = page.getByRole("region", { name: "Wiki link preview" });
  await expect(preview.getByRole("heading", { name: "Synthesis" })).toBeVisible();
  await expect(preview.getByText("Synthesis Body.")).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await preview.getByRole("button", { name: "打开为主文档" }).click();
  await expect(reader.getByRole("heading", { name: "Synthesis" })).toBeVisible();
});
