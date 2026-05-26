import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads overview and navigates with localized sidebar labels and settings", async ({ page }) => {
  await page.goto("/#overview");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("dikw-core 0.2.0")).toBeVisible();
  const knowledgeNav = page.getByRole("navigation", { name: "Knowledge" });
  const interactNav = page.getByRole("navigation", { name: "Interact" });
  await expect(knowledgeNav.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
  await expect(interactNav.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
  await expect(knowledgeNav.getByRole("button", { name: "Chat", exact: true })).toHaveCount(0);
  await expect(knowledgeNav.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await expect(knowledgeNav.getByRole("button", { name: "概览", exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("http://127.0.0.1:8765")).toHaveCount(0);
  await expect(page.getByPlaceholder("Bearer token")).toHaveCount(0);
  await expect(page.getByText(/same-origin/i)).toHaveCount(0);
  await expect(page.getByText("http://127.0.0.1:8765")).toBeVisible();
  await expect(page.getByRole("img", { name: "OpenDIKW" })).toHaveAttribute("src", "/opendikw-avatar.png");

  await knowledgeNav.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Base", exact: true })).toBeVisible();

  await interactNav.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

  await knowledgeNav.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Graph" })).toBeVisible();

  await expect(page.getByRole("button", { name: /产物\s+Artifacts/ })).toHaveCount(0);

  await knowledgeNav.getByRole("button", { name: "Wisdom", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Wisdom" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Server URL")).toHaveValue("http://127.0.0.1:8765");
  await page.getByLabel("Server URL").fill("http://127.0.0.1:8765");
  await page.getByLabel("Token").fill("secret");
  await expect(page.getByText("http://127.0.0.1:8765")).toBeVisible();
  await expect(page.getByText("token configured")).toBeVisible();
  await expect(page.getByText("secret")).toHaveCount(0);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "知识" }).getByRole("button", { name: "概览", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "深色" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});

test("major pages avoid horizontal overflow on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["overview", "chat", "wiki", "graph", "tasks", "wisdom", "settings"]) {
      await page.goto(`/#${route}`);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
        .toBe(true);
    }
  }
});
