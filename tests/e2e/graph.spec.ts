import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("shows the global graph and opens a node in the wiki reader", async ({ page }) => {
  await page.goto("/#graph");

  await expect(page.getByRole("heading", { name: "知识图谱" })).toBeVisible();
  await expect(page.getByText("3 nodes")).toBeVisible();
  await expect(page.getByText("1 link")).toBeVisible();
  await expect(page.getByText("1 unresolved")).toBeVisible();
  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();

  await page.getByRole("button", { name: "Architecture graph node" }).click();
  const detail = page.getByRole("region", { name: "Graph node detail" });
  await expect(detail.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(detail.getByText("Missing Concept")).toBeVisible();

  await detail.getByRole("button", { name: "在知识库打开" }).click();

  await expect(page).toHaveURL(/#wiki$/);
  await expect(page.getByRole("main", { name: "Wiki reader" }).getByRole("heading", { name: "Architecture" })).toBeVisible();
});
