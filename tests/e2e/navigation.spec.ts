import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads overview and navigates with bilingual sidebar labels", async ({ page }) => {
  await page.goto("/#overview");

  await expect(page.getByRole("heading", { name: "工作台概览" })).toBeVisible();
  await expect(page.getByText("dikw-core 0.0.1")).toBeVisible();
  await expect(page.getByRole("button", { name: /概览\s+Overview/ })).toBeVisible();

  await page.getByRole("button", { name: /知识库\s+Wiki/ }).click();
  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();

  await page.getByRole("button", { name: /智慧\s+Wisdom/ }).click();
  await expect(page.getByRole("heading", { name: "智慧沉淀" })).toBeVisible();
});
