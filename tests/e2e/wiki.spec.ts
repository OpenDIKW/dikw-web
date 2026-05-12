import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("reads a wiki page and follows a wikilink", async ({ page }) => {
  await page.goto("/#wiki");

  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Base directory" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "concepts" })).toBeVisible();
  await expect(page.getByText(/Layered DIKW notes/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Wiki link preview" })).toHaveCount(0);
  await expect(page.locator(".wiki-layout")).not.toHaveClass(/wiki-layout--preview-open/);

  const reader = page.getByRole("main", { name: "Wiki reader" });
  await reader.getByRole("link", { name: "Jump to links" }).click();
  await expect(page).toHaveURL(/#wiki$/);
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.getByRole("tab", { name: "Info" }).click();
  const infoPanel = page.getByRole("tabpanel", { name: "Info" });
  await expect(infoPanel.getByText("wiki/concepts/architecture.md")).toBeVisible();
  await expect(infoPanel.getByText("draft")).toBeVisible();
  await expect(infoPanel.getByText("#DIKW")).toBeVisible();
  await expect(infoPanel.getByText("source/a.md")).toBeVisible();

  await page.getByRole("tab", { name: "Outline" }).click();
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Links", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Source" }).click();
  await expect(reader.getByText(/title: Architecture/)).toBeVisible();

  await page.getByRole("tab", { name: "Read" }).click();
  await reader.getByRole("button", { name: "Synthesis", exact: true }).click();

  const preview = page.getByRole("region", { name: "Wiki link preview" });
  await expect(preview.getByRole("heading", { name: "Synthesis" })).toBeVisible();
  await expect(preview.getByText("Synthesis Body.")).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await expect(page.locator(".wiki-layout")).toHaveClass(/wiki-layout--preview-open/);

  await preview.getByRole("button", { name: "Collapse link preview" }).click();
  await expect(page.getByRole("region", { name: "Wiki link preview" })).toHaveCount(0);
  await expect(page.locator(".wiki-layout")).not.toHaveClass(/wiki-layout--preview-open/);
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await reader.getByRole("button", { name: "Synthesis", exact: true }).click();

  await page.getByRole("region", { name: "Wiki link preview" }).getByRole("button", { name: "Open as main document" }).click();
  await expect(reader.getByRole("heading", { name: "Synthesis" })).toBeVisible();

  await page.getByRole("tree", { name: "Base directory" }).getByRole("button", { name: "concepts", exact: true }).click();
  await expect(reader.getByText("Select a document to start reading")).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Synthesis" })).toHaveCount(0);
});
