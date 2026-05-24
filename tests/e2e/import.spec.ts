import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("sidebar exposes the Import route and the picker page loads", async ({ page }) => {
  await page.goto("/#import");

  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeVisible();

  const knowledgeNav = page.getByRole("navigation", { name: "Knowledge" });
  await expect(
    knowledgeNav.getByRole("button", { name: "Import", exact: true })
  ).toBeVisible();
});

test("selecting a markdown file shows the bundle preview", async ({ page }) => {
  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileChooser = page.locator('[data-testid="import-file-input"]');
  await fileChooser.setInputFiles([
    {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n\nNo embeds here.\n")
    }
  ]);

  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByText("Ready to import")).toBeVisible();
  await expect(page.getByTestId("import-start")).toBeEnabled();
});
