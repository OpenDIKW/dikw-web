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
