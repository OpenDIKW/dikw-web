import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

const englishRoutes = [
  { hash: "overview", heading: "Overview" },
  { hash: "query", heading: "Agent Chat" },
  { hash: "wiki", heading: "Knowledge" },
  { hash: "graph", heading: "Graph" },
  { hash: "tasks", heading: "Tasks" },
  { hash: "wisdom", heading: "Wisdom" },
  { hash: "settings", heading: "Settings" }
];

const chineseRoutes = [
  { hash: "overview", heading: "工作台概览" },
  { hash: "query", heading: "Agent 对话" },
  { hash: "wiki", heading: "知识库" },
  { hash: "graph", heading: "知识图谱" },
  { hash: "tasks", heading: "任务" },
  { hash: "wisdom", heading: "智慧沉淀" },
  { hash: "settings", heading: "设置" }
];

const cjkText = /[\u3400-\u9fff]/;
const businessRoutes = ["overview", "query", "retrieve", "wiki", "graph", "tasks", "wisdom"];

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("default English locale keeps page chrome single-language", async ({ page }) => {
  await page.goto("/#overview");

  const knowledgeNav = page.getByRole("navigation", { name: "Knowledge" });
  await expect(knowledgeNav.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
  await expect(knowledgeNav.getByRole("button", { name: "概览", exact: true })).toHaveCount(0);

  for (const route of englishRoutes) {
    await page.goto(`/#${route.hash}`);
    const header = page.getByTestId("page-header");
    await expect(header.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(header.locator(".eyebrow")).toHaveCount(0);
    await expect(header).not.toContainText(cjkText);
  }
});

test("Chinese locale keeps page chrome single-language", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByRole("button", { name: "简体中文" }).click();

  const knowledgeNav = page.getByRole("navigation", { name: "知识" });
  await expect(knowledgeNav.getByRole("button", { name: "概览", exact: true })).toBeVisible();
  await expect(knowledgeNav.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);

  for (const route of chineseRoutes) {
    await page.goto(`/#${route.hash}`);
    const header = page.getByTestId("page-header");
    await expect(header.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expect(header.locator(".eyebrow")).toHaveCount(0);
    await expect(header).not.toContainText(/Overview|Knowledge|Graph|Tasks|Wisdom|Settings/);
  }
});

test("default English locale keeps page-level chrome free of Chinese fallback text", async ({ page }) => {
  for (const route of businessRoutes) {
    await page.goto(`/#${route}`);
    await expect(page.locator(".content")).not.toContainText(cjkText);
    await expect(page.locator(".content .eyebrow")).toHaveCount(0);
  }

  await page.goto("/#query");
  await expect(page.getByPlaceholder("Ask the DIKW agent about the knowledge base")).toBeVisible();
  await expect(page.getByText("Start a DIKW conversation")).toBeVisible();
  await expect(page.getByText("No sources yet")).toBeVisible();

  await page.goto("/#retrieve");
  await expect(page.getByPlaceholder("Search chunks and page refs")).toBeVisible();
  await expect(page.getByText("No chunks yet")).toBeVisible();
  await expect(page.getByText("No page refs")).toBeVisible();

  await page.goto("/#tasks");
  await expect(page.getByText("Events not loaded")).toBeVisible();

  await page.goto("/#wisdom");
  await expect(page.getByLabel("Status")).toBeVisible();
  await expect(page.getByLabel("Kind")).toBeVisible();

  await page.goto("/#graph");
  await expect(page.getByText(/Reading \d+ \/ \d+ pages/)).toBeVisible();
});
