import { expect, test } from "./harness";
import { choCqaAssetId } from "./fixtures";
import { mockDikwApi } from "./mockApi";
import scientificFixture from "../fixtures/scientific-markdown.json" with { type: "json" };

test.describe("Source markdown — images and charts", () => {
  test.beforeEach(async ({ page }) => {
    await mockDikwApi(page);
  });

  for (const theme of ["light", "dark"]) {
    test(`preserves MinerU citations, scientific table values and outline anchors (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((theme) => localStorage.setItem("dikw-web.theme", theme), theme);
      await page.route(
        (url) => decodeURIComponent(url.pathname) === "/v1/base/pages/sources/cho-cqa/cho-cqa.md",
        async (route) => {
          await route.fulfill({
            json: {
              doc_id: "source-cho-cqa",
              path: "sources/cho-cqa/cho-cqa.md",
              layer: "source",
              title: "CHO CQA",
              body: scientificFixture.body,
              anchors: [],
              assets: [],
            },
          });
        },
      );
      await page.goto("/#base");
      await page.getByRole("treeitem", { name: "sources" }).click();
      await page.getByRole("treeitem", { name: "cho-cqa", exact: false }).click();
      await page.getByRole("button", { name: /CHO CQA/i }).click();
      const reader = page.getByRole("main", { name: "Wiki reader" });
      await expect(reader.locator("h2#results sup")).toHaveText("*");
      await expect(reader.locator("p sup")).toHaveText("18,19");
      await expect(reader.locator("p sub")).toHaveText("2");
      await expect(reader.locator("td")).toHaveText(scientificFixture.cells);
      await expect(reader.locator("td i")).toHaveText("E. coli");
      await expect(reader).not.toContainText("<sup>");
      await expect(
        reader.locator(".markdown-body [style], .markdown-body [onclick], .markdown-body script"),
      ).toHaveCount(0);
      await reader.screenshot({ path: `test-results/scientific-reader-${theme}.png` });
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      await expect(
        page.getByRole("button", { name: scientificFixture.heading, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: scientificFixture.heading, exact: true }).click();
      await expect(reader.locator("h2#results")).toBeVisible();
    });
  }

  test("renders Obsidian image embed against /v1/assets and shows charts", async ({ page }) => {
    await page.goto("/#base");

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
