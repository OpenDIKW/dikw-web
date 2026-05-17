import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("shows the global graph and opens a node in the wiki reader", async ({ page }) => {
  const graphDataRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/v1/base/pages")) {
      graphDataRequests.push(path);
    }
  });

  await page.goto("/#graph");

  await expect(page.getByRole("heading", { name: "Graph" })).toBeVisible();
  await expect(page.getByText("4 nodes")).toBeVisible();
  await expect(page.getByText("1 link")).toBeVisible();
  await expect(page.getByText("1 unresolved")).toBeVisible();
  const legend = page.getByLabel("Graph legend");
  await expect(legend.getByText("Wiki", { exact: true })).toBeVisible();
  await expect(legend.getByText("Source", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Architecture source graph node" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wiki" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sources" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
  await expect(page.getByLabel("Repel strength")).toHaveCount(0);
  await expect(page.getByLabel("Link distance")).toHaveCount(0);
  await expect(page.getByLabel("Node size")).toHaveCount(0);
  await expect(page.getByLabel("Link thickness")).toHaveCount(0);
  expect(graphDataRequests).toEqual([]);

  await page.getByRole("button", { name: "Architecture graph node" }).click();
  const detail = page.getByRole("region", { name: "Graph node detail" });
  await expect(detail.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(detail.getByText("Missing Concept")).toBeVisible();

  await detail.getByRole("button", { name: "Open in Knowledge" }).click();

  await expect(page).toHaveURL(/#wiki$/);
  await expect(page.getByRole("main", { name: "Wiki reader" }).getByRole("heading", { name: "Architecture" })).toBeVisible();
});

test("opens source graph nodes in the matching knowledge document", async ({ page }) => {
  await page.goto("/#graph");

  await page.getByRole("button", { name: "Architecture source graph node" }).click();
  const detail = page.getByRole("region", { name: "Graph node detail" });
  await expect(detail.getByRole("heading", { name: "Architecture source" })).toBeVisible();

  await detail.getByRole("button", { name: "Open in Knowledge" }).click();

  await expect(page).toHaveURL(/#wiki$/);
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText("sources/architecture.md")).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Architecture source" })).toBeVisible();
  await expect(reader.getByText("Original source body.")).toBeVisible();
});

test("graph canvas renders on first entry without manual refresh", async ({ page }) => {
  await page.goto("/#graph");

  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();
  await expect(page.locator('.graph-pixi-mount[data-ready="true"]')).toBeVisible({ timeout: 15000 });

  await expect
    .poll(
      async () =>
        Number(await page.locator(".graph-pixi-stage").getAttribute("data-render-count")) || 0,
      { timeout: 5000 }
    )
    .toBeGreaterThanOrEqual(1);
});

test("renders a nonblank Pixi graph canvas", async ({ page }) => {
  await page.goto("/#graph");

  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();
  await expect(page.locator(".graph-pixi-mount canvas")).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Graph search").focus();

  const canvasContract = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".graph-pixi-stage");
    const canvas = document.querySelector<HTMLCanvasElement>(".graph-pixi-stage canvas");
    const searchBox = document.querySelector(".graph-search");
    const input = document.querySelector(".graph-search input");
    if (!stage || !canvas || !searchBox || !input) {
      throw new Error("Graph Pixi stage was not rendered");
    }
    const searchStyle = getComputedStyle(searchBox);
    const inputStyle = getComputedStyle(input);
    const rect = canvas.getBoundingClientRect();
    return {
      searchBoxShadow: searchStyle.boxShadow,
      inputBoxShadow: inputStyle.boxShadow,
      stageWidth: stage.getBoundingClientRect().width,
      stageHeight: stage.getBoundingClientRect().height,
      canvasWidth: rect.width,
      canvasHeight: rect.height
    };
  });

  expect(canvasContract.searchBoxShadow).not.toBe("none");
  expect(canvasContract.inputBoxShadow).toBe("none");
  expect(canvasContract.stageWidth).toBeGreaterThan(300);
  expect(canvasContract.stageHeight).toBeGreaterThan(500);
  expect(canvasContract.canvasWidth).toBeGreaterThan(300);
  expect(canvasContract.canvasHeight).toBeGreaterThan(500);
});
