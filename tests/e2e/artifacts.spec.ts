import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("generates artifacts from wiki, tasks, query, and graph", async ({ page }) => {
  await page.goto("/#artifacts");
  await expect(page.getByRole("heading", { name: "产物工作台" })).toBeVisible();
  await expect(page.getByText("尚未生成产物")).toBeVisible();

  await page.goto("/#wiki");
  await expect(page.getByText("Layered DIKW notes.")).toBeVisible();
  await page.getByRole("button", { name: "Generate explainer" }).click();
  await expect(page).toHaveURL(/#artifacts$/);
  await expect(page.getByRole("heading", { name: "Architecture explainer" })).toBeVisible();
  await expect(page.getByText("TL;DR")).toBeVisible();
  await expect(page.locator("details").filter({ hasText: "Raw data" })).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "打开来源" }).click();
  await expect(page).toHaveURL(/#wiki$/);
  await expect(page.getByRole("main", { name: "Wiki reader" }).getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.goto("/#tasks");
  await page.getByRole("button", { name: /Load events/ }).click();
  await expect(page.getByText("4 events")).toBeVisible();
  await page.getByRole("button", { name: "Generate run report" }).click();
  await expect(page.getByRole("heading", { name: "eval run report" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Architecture explainer/ })).toBeVisible();

  await page.goto("/#query");
  await page.getByLabel("Question").fill("What is DIKW?");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("Layered answer.")).toBeVisible();
  await page.getByRole("button", { name: "Generate answer report" }).click();
  await expect(page.getByRole("heading", { name: "What is DIKW? answer report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence chain" })).toBeVisible();

  await page.goto("/#graph");
  await page.getByRole("button", { name: "Architecture graph node" }).click();
  await page.getByRole("region", { name: "Graph node detail" }).getByRole("button", { name: "Generate graph explainer" }).click();
  await expect(page.getByRole("heading", { name: "Architecture graph explainer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unresolved links" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
});
