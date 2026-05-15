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
  await expect(page.getByText("3 nodes")).toBeVisible();
  await expect(page.getByText("1 link")).toBeVisible();
  await expect(page.getByText("1 unresolved")).toBeVisible();
  const legend = page.getByLabel("Graph legend");
  await expect(legend.getByText("Wiki", { exact: true })).toBeVisible();
  await expect(legend.getByText("Source", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Knowledge graph" })).toBeVisible();
  expect(graphDataRequests).toEqual([]);

  await page.getByRole("button", { name: "Architecture graph node" }).click();
  const detail = page.getByRole("region", { name: "Graph node detail" });
  await expect(detail.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(detail.getByText("Missing Concept")).toBeVisible();

  await detail.getByRole("button", { name: "Open in Knowledge" }).click();

  await expect(page).toHaveURL(/#wiki$/);
  await expect(page.getByRole("main", { name: "Wiki reader" }).getByRole("heading", { name: "Architecture" })).toBeVisible();
});

test("uses a single search focus ring and balanced graph mark styles", async ({ page }) => {
  await page.goto("/#graph");

  const search = page.getByLabel("Graph search");
  await search.focus();

  const styleContract = await page.evaluate(() => {
    const searchBox = document.querySelector(".graph-search");
    const input = document.querySelector(".graph-search input");
    const circle = document.querySelector<SVGCircleElement>(".graph-svg__nodes circle");
    const line = document.querySelector<SVGLineElement>(".graph-svg__edges line");
    const label = document.querySelector<SVGTextElement>(".graph-svg__nodes text");
    if (!searchBox || !input || !circle || !line || !label) {
      throw new Error("Graph style fixtures were not rendered");
    }
    const searchStyle = getComputedStyle(searchBox);
    const inputStyle = getComputedStyle(input);
    const circleStyle = getComputedStyle(circle);
    const lineStyle = getComputedStyle(line);
    const labelStyle = getComputedStyle(label);
    return {
      searchBoxShadow: searchStyle.boxShadow,
      inputBoxShadow: inputStyle.boxShadow,
      circleRadius: Number.parseFloat(circle.getAttribute("r") ?? "0"),
      circleStrokeWidth: Number.parseFloat(circleStyle.strokeWidth),
      lineOpacity: Number.parseFloat(lineStyle.opacity),
      lineStrokeWidth: Number.parseFloat(lineStyle.strokeWidth),
      labelFontSize: labelStyle.fontSize
    };
  });

  expect(styleContract.searchBoxShadow).not.toBe("none");
  expect(styleContract.inputBoxShadow).toBe("none");
  expect(styleContract.circleRadius).toBeGreaterThanOrEqual(9);
  expect(styleContract.circleRadius).toBeLessThanOrEqual(12.5);
  expect(styleContract.circleStrokeWidth).toBeLessThanOrEqual(2);
  expect(styleContract.lineOpacity).toBeGreaterThanOrEqual(0.66);
  expect(styleContract.lineStrokeWidth).toBeGreaterThanOrEqual(1.1);
  expect(styleContract.labelFontSize).toBe("13px");
});
