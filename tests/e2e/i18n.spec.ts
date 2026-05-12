import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

const englishRoutes = [
  { hash: "overview", heading: "Overview" },
  { hash: "wiki", heading: "Knowledge" },
  { hash: "graph", heading: "Graph" },
  { hash: "tasks", heading: "Tasks" },
  { hash: "wisdom", heading: "Wisdom" },
  { hash: "settings", heading: "Settings" }
];

const chineseRoutes = [
  { hash: "overview", heading: "工作台概览" },
  { hash: "wiki", heading: "知识库" },
  { hash: "graph", heading: "知识图谱" },
  { hash: "tasks", heading: "任务" },
  { hash: "wisdom", heading: "智慧沉淀" },
  { hash: "settings", heading: "设置" }
];

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("default English locale keeps page chrome single-language", async ({ page }) => {
  await page.goto("/#overview");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "概览", exact: true })).toHaveCount(0);

  for (const route of englishRoutes) {
    await page.goto(`/#${route.hash}`);
    const header = page.getByTestId("page-header");
    await expect(header.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(header).not.toContainText(/工作台概览|知识库|知识图谱|任务查看|智慧沉淀|设置/);
  }
});

test("Chinese locale keeps page chrome single-language", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByRole("button", { name: "简体中文" }).click();

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("button", { name: "概览", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);

  for (const route of chineseRoutes) {
    await page.goto(`/#${route.hash}`);
    const header = page.getByTestId("page-header");
    await expect(header.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(header).not.toContainText(/Overview|Knowledge|Graph|Tasks|Wisdom|Settings/);
  }
});
