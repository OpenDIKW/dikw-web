import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("reads a wiki page and follows a wikilink", async ({ page }) => {
  await page.goto("/#base");

  await expect(page.getByRole("heading", { name: "Base", exact: true })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Base directory" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "concepts" })).toBeVisible();
  await expect(page.getByText(/Layered DIKW notes/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Wiki link preview" })).toHaveCount(0);
  await expect(page.locator(".wiki-layout")).not.toHaveClass(/wiki-layout--preview-open/);

  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.locator(".markdown-table-wrap table").filter({ hasText: "Hybrid studies" })).toBeVisible();
  await expect(reader.locator(".katex").first()).toBeVisible();
  await expect(reader).not.toContainText("<table>");

  await reader.getByRole("link", { name: "Jump to links" }).click();
  await expect(page).toHaveURL(/#base$/);
  await expect(reader.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.getByRole("tab", { name: "Info" }).click();
  const infoPanel = page.getByRole("tabpanel", { name: "Info" });
  await expect(infoPanel.getByText("knowledge/concepts/architecture.md")).toBeVisible();
  await expect(infoPanel.getByText("draft")).toBeVisible();
  await expect(infoPanel.getByText("#DIKW")).toBeVisible();
  await expect(infoPanel.getByText("source/a.md")).toBeVisible();

  await page.getByRole("tab", { name: "Outline" }).click();
  await expect(reader.getByRole("button", { name: "Architecture", exact: true })).toBeVisible();
  await expect(reader.getByRole("button", { name: "Links", exact: true })).toBeVisible();

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

test("jumps to a heading via the Outline tab and exposes a back-to-top button", async ({ page }) => {
  await page.goto("/#base");

  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();

  // Instrument Element.scrollIntoView so we can verify the outline button calls it
  // on the target heading. Fixture docs are short and can't always produce a
  // measurable scroll delta on small viewports, so we assert the API contract
  // instead of the visual side effect.
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    (window as unknown as { __scrolledIds: string[] }).__scrolledIds = [];
    Element.prototype.scrollIntoView = function patched(this: Element, ...args: unknown[]) {
      (window as unknown as { __scrolledIds: string[] }).__scrolledIds.push(this.id || "");
      return original.apply(this, args as []);
    };
  });

  // Jump from Outline → Read tab → triggers scrollIntoView on the "links" heading.
  await page.getByRole("tab", { name: "Outline" }).click();
  await reader.getByRole("button", { name: "Links", exact: true }).click();
  await expect(reader.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
  await expect(reader.locator("#links")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __scrolledIds: string[] }).__scrolledIds))
    .toContain("links");

  // Back-to-top button: hidden until user scrolls past the threshold.
  await expect(reader.getByRole("button", { name: "Back to top" })).toHaveCount(0);
  // Fixture body is short. Inject a spacer so the document is tall enough to scroll.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.id = "__e2e-scroll-spacer";
    spacer.style.height = "2000px";
    document.body.appendChild(spacer);
    window.scrollTo(0, 1200);
  });
  await expect(reader.getByRole("button", { name: "Back to top" })).toBeVisible();

  // Clicking it scrolls back to the top and hides the button again.
  await reader.getByRole("button", { name: "Back to top" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  await expect(reader.getByRole("button", { name: "Back to top" })).toHaveCount(0);
});

test("source page inlines K-page title in body and keeps unmatched refs in the panel", async ({ page }) => {
  await page.goto("/#base");

  const tree = page.getByRole("tree", { name: "Base directory" });
  await tree.getByRole("button", { name: "sources", exact: true }).click();
  await tree.getByRole("button", { name: /Architecture source/ }).click();

  const reader = page.getByRole("main", { name: "Wiki reader" });
  const readTab = reader.getByRole("tabpanel", { name: "Read" });

  // Body 内联:fixture body 含 "Architecture" → 应该被替换成可点的 inline wikilink button。
  const inlineArchitecture = readTab.getByRole("button", { name: "Architecture", exact: true });
  await expect(inlineArchitecture).toBeVisible();
  await expect(inlineArchitecture).toHaveClass(/inline-wikilink/);

  // Panel 只剩 Synthesis(body 中无字面 "Synthesis")。
  const refs = page.getByRole("region", { name: "Linked references" });
  await expect(refs.getByRole("button", { name: "Synthesis", exact: true })).toBeVisible();
  await expect(refs.getByRole("button", { name: "Architecture", exact: true })).toHaveCount(0);

  // Synthesis 只有 sourced(matched 的 Architecture 没在 panel 里,所以也没 linked chip)。
  const synthesisItem = refs.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Synthesis", exact: true }) });
  await expect(synthesisItem.getByText("sourced", { exact: true })).toBeVisible();
  await expect(refs.getByText("linked", { exact: true })).toHaveCount(0);

  // 点击 inline button 弹 preview。
  await inlineArchitecture.click();
  const preview = page.getByRole("region", { name: "Wiki link preview" });
  await expect(preview.getByRole("heading", { name: "Architecture" })).toBeVisible();

  // Source tab 显示原始 body,不含 [[...|...]] 字符。
  await preview.getByRole("button", { name: "Collapse link preview" }).click();
  await reader.getByRole("tab", { name: "Source" }).click();
  await expect(reader.getByText(/The Architecture is the main topic/)).toBeVisible();
  await expect(reader.locator("pre.wiki-source-code")).not.toContainText("[[Architecture|");
});

test("renders source details blocks with Mermaid diagrams", async ({ page }) => {
  await page.goto("/#base");

  await page.getByLabel("Filter").fill("active-learning");
  await page.getByRole("treeitem", { name: "Active Learning Medium" }).getByRole("button").click();
  const reader = page.getByRole("main", { name: "Wiki reader" });

  await expect(reader.getByRole("heading", { name: "Active Learning Medium" })).toBeVisible();
  await expect(reader).not.toContainText("<details>");

  await reader.getByText("flowchart").click();
  await expect(reader.locator(".markdown-details")).toBeVisible();
  await expect(reader.locator(".mermaid-diagram svg")).toBeVisible();
  await expect(page).toHaveURL(/#base$/);
});
