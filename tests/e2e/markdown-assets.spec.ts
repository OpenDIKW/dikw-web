import { expect, test } from "@playwright/test";
import { choCqaAssetId } from "./fixtures";
import { mockDikwApi } from "./mockApi";

test.describe("Source markdown — images and charts", () => {
  test.beforeEach(async ({ page }) => {
    await mockDikwApi(page);
  });

  test("renders Obsidian image embed against /v1/assets and shows charts", async ({ page }) => {
    await page.goto("/#wiki");

    const tree = page.getByRole("tree", { name: "Base directory" });
    await tree.getByRole("treeitem", { name: "sources" }).waitFor();
    await page.getByRole("treeitem", { name: "sources" }).click();
    await page.getByRole("treeitem", { name: "cho-cqa", exact: false }).click();
    await page.getByRole("button", { name: /CHO CQA/i }).click();

    const reader = page.getByRole("main", { name: "Wiki reader" });
    await expect(reader.getByRole("heading", { name: "CHO CQA", level: 1 })).toBeVisible();

    const img = reader.locator("img.markdown-image").first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", new RegExp(`/v1/assets/${choCqaAssetId}$`));

    await expect(reader.locator(".md-broken-image")).toContainText("deadbeef");

    const barChart = reader.locator('.markdown-chart[data-chart-type="bar"]').first();
    await expect(barChart).toBeVisible();
    await expect(barChart.locator("canvas").first()).toBeVisible();

    const heatChart = reader.locator('.markdown-chart[data-chart-type="heatmap"]');
    await expect(heatChart).toBeVisible();
    await expect(heatChart.locator("canvas").first()).toBeVisible();

    const badChartFallback = reader.locator(".markdown-details", { hasText: "Not a table at all" });
    await expect(badChartFallback).toBeVisible();
    expect(await reader.locator('.markdown-chart[data-chart-type="bar"]').count()).toBe(1);

    await reader.screenshot({ path: "test-results/markdown-assets-after.png" });
  });
});
