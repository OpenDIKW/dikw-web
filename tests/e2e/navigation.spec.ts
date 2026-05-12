import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads overview and navigates with localized sidebar labels and settings", async ({ page }) => {
  await page.goto("/#overview");

  await expect(page.getByRole("heading", { name: "工作台概览" })).toBeVisible();
  await expect(page.getByText("dikw-core 0.2.0")).toBeVisible();
  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "概览", exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("同源代理，或 http://127.0.0.1:8765")).toHaveCount(0);
  await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
  await expect(page.getByText("same-origin /v1 proxy")).toBeVisible();
  await expect(page.getByRole("img", { name: "OpenDIKW" })).toHaveAttribute("src", "/opendikw-avatar.png");

  await primaryNav.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();

  await primaryNav.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("heading", { name: "知识图谱" })).toBeVisible();

  await expect(page.getByRole("button", { name: /产物\s+Artifacts/ })).toHaveCount(0);

  await primaryNav.getByRole("button", { name: "Wisdom", exact: true }).click();
  await expect(page.getByRole("heading", { name: "智慧沉淀" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Server URL").fill("http://127.0.0.1:8765");
  await page.getByLabel("Token").fill("secret");
  await expect(page.getByText("custom server: http://127.0.0.1:8765")).toBeVisible();
  await expect(page.getByText("token configured")).toBeVisible();
  await expect(page.getByText("secret")).toHaveCount(0);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(primaryNav.getByRole("button", { name: "概览", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "深色" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});

test("major pages avoid horizontal overflow on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["overview", "wiki", "graph", "tasks", "wisdom", "settings"]) {
      await page.goto(`/#${route}`);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
        .toBe(true);
    }
  }
});
