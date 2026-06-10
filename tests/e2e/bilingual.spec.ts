import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

const TOGGLE = "Show an AI Chinese translation alongside the source";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
  // Enable the sidecar translator and serve the job + poll flow (submit →
  // succeeded → result). A generous result map aligns 1:1 with whatever text
  // blocks the page splits into (extra indices are ignored by the client).
  await page.route("**/web/translate/health", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route("**/web/translate/submit", (route) =>
    route.fulfill({ status: 202, json: { jobId: "e2e-job" } }),
  );
  await page.route("**/web/translate/jobs/e2e-job", (route) =>
    route.fulfill({ json: { status: "succeeded" } }),
  );
  await page.route("**/web/translate/jobs/e2e-job/result", (route) =>
    route.fulfill({
      json: { blocks: Array.from({ length: 50 }, (_, i) => ({ i, tr: `中文译文 ${i}` })) },
    }),
  );
});

test("toggles AI translation into a dual-column view on an English page", async ({ page }) => {
  await page.goto("/#base");
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();

  // The fused toggle only appears for English pages when the translator is on.
  const toggle = page.getByRole("switch", { name: TOGGLE });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  const cols = page.locator(".bilingual-cols");
  await expect(cols).toBeVisible();
  const colhead = reader.locator(".bi-colhead");
  await expect(colhead.getByText("Source", { exact: true })).toBeVisible();
  await expect(colhead.getByText("Translation", { exact: true })).toBeVisible();
  // Translation resolves and the right column shows the Chinese text.
  await expect(
    reader
      .locator(".bi-block--tr")
      .getByText(/中文译文/)
      .first(),
  ).toBeVisible();

  // Toggling off returns to the single-column reader.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".bilingual-cols")).toHaveCount(0);
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();
});

test("translates the preview card when a translated-column wikilink is clicked", async ({
  page,
}) => {
  // Per-submit jobs: the body translation keeps a clickable wikilink in the tr
  // column; the preview translation ([title, summary] of the Synthesis target)
  // returns a Chinese pair for the card. Later route registrations win, so
  // these override the generic beforeEach translate mocks.
  const results = new Map<string, unknown>();
  let n = 0;
  await page.route("**/web/translate/submit", async (route) => {
    const blocks = (route.request().postDataJSON() as { blocks: string[] }).blocks;
    n += 1;
    const jobId = `pj${n}`;
    const isPreview = blocks.length === 2 && blocks[0] === "Synthesis";
    results.set(jobId, {
      blocks: isPreview
        ? [
            { i: 0, tr: "合成笔记" },
            { i: 1, tr: "这是合成页的中文摘要。" },
          ]
        : blocks.map((b, i) => ({
            i,
            tr: b.includes("[[Synthesis]]") ? "中文段落,见 [[Synthesis|合成]]。" : `中文 ${i}`,
          })),
    });
    await route.fulfill({ status: 202, json: { jobId } });
  });
  await page.route(/\/web\/translate\/jobs\/pj\d+$/, (route) =>
    route.fulfill({ json: { status: "succeeded" } }),
  );
  await page.route(/\/web\/translate\/jobs\/pj\d+\/result$/, (route) => {
    const m = /jobs\/(pj\d+)\/result/.exec(route.request().url());
    return route.fulfill({ json: results.get(m![1]) });
  });

  await page.goto("/#base");
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();
  await page.getByRole("switch", { name: TOGGLE }).click();

  // Click the wikilink in the TRANSLATED column → Chinese card with AI badge.
  await page.locator(".bi-block--tr .inline-wikilink", { hasText: "合成" }).first().click();
  await expect(page.getByRole("heading", { name: "合成笔记" })).toBeVisible();
  await expect(page.getByText("这是合成页的中文摘要。")).toBeVisible();
  await expect(page.locator(".wiki-preview-card__ai")).toHaveText("AI");

  // The same link from the SOURCE column previews the original, badge-free.
  await page.locator(".bi-block--src .inline-wikilink", { hasText: "Synthesis" }).first().click();
  await expect(page.getByRole("heading", { name: "Synthesis", exact: true })).toBeVisible();
  await expect(page.locator(".wiki-preview-card__ai")).toHaveCount(0);
});

test("keeps the dual-column view readable in dark mode", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dikw-web.theme", "dark");
  });
  await page.goto("/#base");
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();

  await page.getByRole("switch", { name: TOGGLE }).click();
  await expect(page.locator(".bilingual-cols")).toBeVisible();
  await expect(
    reader
      .locator(".bi-block--tr")
      .getByText(/中文译文/)
      .first(),
  ).toBeVisible();
});
