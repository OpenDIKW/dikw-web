import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("sidebar exposes the Import route and the picker page loads", async ({ page }) => {
  await page.goto("/#import");

  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
  // Directory upload was removed — only the file picker remains.
  await expect(page.getByRole("button", { name: "Choose folder" })).toHaveCount(0);

  const knowledgeNav = page.getByRole("navigation", { name: "Knowledge" });
  await expect(knowledgeNav.getByRole("button", { name: "Import", exact: true })).toBeVisible();
});

test("selecting a markdown file shows the bundle preview", async ({ page }) => {
  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileChooser = page.locator('[data-testid="import-file-input"]');
  await fileChooser.setInputFiles([
    {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n\nNo embeds here.\n"),
    },
  ]);

  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByText("Ready to import")).toBeVisible();
  await expect(page.getByTestId("import-start")).toBeEnabled();
});

test("filters unsupported formats at selection and surfaces a notice", async ({ page }) => {
  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileChooser = page.locator('[data-testid="import-file-input"]');
  await fileChooser.setInputFiles([
    {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n\nNo embeds here.\n"),
    },
    {
      name: "archive.zip",
      mimeType: "application/zip",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
  ]);

  // The supported markdown is bundled; the .zip is filtered with a notice
  // and never appears in the preview.
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByText("Skipped 1 file(s) in an unsupported format.")).toBeVisible();
  await expect(page.getByText("archive.zip")).toHaveCount(0);
});
