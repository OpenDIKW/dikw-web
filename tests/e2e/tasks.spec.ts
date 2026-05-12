import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads eval task events and keeps raw JSON collapsed", async ({ page }) => {
  await page.goto("/#tasks");

  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.locator(".eval-dataset-line strong", { hasText: "synthetic-diverse-v1" })).toBeVisible();

  await page.getByRole("button", { name: /Load events/ }).click();
  await expect(page.getByText("4 events")).toBeVisible();
  await expect(page.getByText("#4")).toBeVisible();
  await expect(page.getByText("Raw final event")).toBeVisible();

  const rawFinal = page.locator("details").filter({ hasText: "Raw final event" });
  await expect(rawFinal).not.toHaveAttribute("open", "");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
});
