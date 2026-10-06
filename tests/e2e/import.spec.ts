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

test("completed import outcomes and navigation fit a narrow viewport in both themes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "dikw-web.importPipeline",
      JSON.stringify({
        stage: "done",
        coreUrl: "http://127.0.0.1:8765",
        synthesisDeferred: true,
        packagePaths: { 0: "sources/new-paper.md" },
        importResult: {
          import_id: "fixture",
          applied_at: "now",
          files_count: 1,
          bytes: 64,
          committed: [0],
          rejected: [],
          warnings: [
            {
              id: 0,
              code: "source_content_matches",
              detail: { md_path: "sources/new-paper.md", existing_path: "sources/old-paper.md" },
            },
          ],
        },
      }),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.goto("/#import");
    await page.evaluate((value) => localStorage.setItem("dikw-web.theme", value), theme);
    await page.reload();
    await expect(page.getByTestId("import-done")).toBeVisible();
    await expect(page.getByTestId("import-open-tasks")).toBeVisible();
    await expect(page.getByTestId("import-done-open-wiki")).toBeVisible();
    await expect(page.getByTestId("import-done-open-graph")).toBeVisible();
    await expect(page.getByTestId("import-warnings-packages")).toBeVisible();
    const width = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  }
});
