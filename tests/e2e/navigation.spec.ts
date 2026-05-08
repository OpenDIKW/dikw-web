import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads overview and navigates with bilingual sidebar labels", async ({ page }) => {
  await page.goto("/#overview");

  await expect(page.getByRole("heading", { name: "工作台概览" })).toBeVisible();
  await expect(page.getByText("dikw-core 0.2.0")).toBeVisible();
  await expect(page.getByRole("button", { name: /概览\s+Overview/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "OpenDIKW" })).toHaveAttribute("src", "/opendikw-avatar.png");

  await page.getByRole("button", { name: /知识库\s+Wiki/ }).click();
  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();

  await page.getByRole("button", { name: /智慧\s+Wisdom/ }).click();
  await expect(page.getByRole("heading", { name: "智慧沉淀" })).toBeVisible();
});

test("major pages avoid horizontal overflow on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["overview", "wiki", "tasks", "wisdom"]) {
      await page.goto(`/#${route}`);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
        .toBe(true);
    }
  }
});
