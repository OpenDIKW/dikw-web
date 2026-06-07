// Manual smoke test for the redesigned Import page.
// NOT run by CI (playwright.config.ts testDir = ./tests/e2e).
//
// Drives the redesigned IdlePicker / BundlePreview against the synthetic
// multimodal corpus and captures screenshots as evidence.
//
// Run:  npx playwright test tests/manual/import-corpus.spec.ts --config=playwright.config.ts --project=chromium --headed --workers=1

import { expect, test } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursively collect absolute file paths under ``root`` so we can feed a
 *  whole corpus into the multi-file <input> (directory upload was removed). */
function collectFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

// Override via env var so the spec is portable across checkouts.
// e.g. DIKW_IMPORT_CORPUS_ROOT=/path/to/corpus npx playwright test ...
const CORPUS_ROOT = process.env.DIKW_IMPORT_CORPUS_ROOT;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!CORPUS_ROOT) {
    throw new Error(
      "Set DIKW_IMPORT_CORPUS_ROOT to the directory you want to import before running this manual spec.",
    );
  }
});

test("redesigned picker accepts the corpus folder and renders preview", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  // Capture the idle dropzone first.
  await page.screenshot({
    path: testInfo.outputPath("01-idle.png"),
    fullPage: true,
  });

  // Directory upload was removed; feed every file in the corpus into the
  // multi-file input instead.
  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles(collectFiles(CORPUS_ROOT!));

  // BundlePreview should appear within a few seconds (build is in-browser).
  await expect(page.getByTestId("import-preview")).toBeVisible({
    timeout: 30_000,
  });

  // Take a screenshot of the preview state.
  await page.screenshot({
    path: testInfo.outputPath("02-preview.png"),
    fullPage: true,
  });

  // The included list should have at least one row each for md + assets.
  const included = page.getByTestId("import-included-list");
  await expect(included).toBeVisible();
  const includedRowCount = await included.locator(".import-file-row").count();
  console.log(`[preview] included rows: ${includedRowCount}`);
  expect(includedRowCount).toBeGreaterThan(0);

  // Unsupported formats are now filtered at selection, so the skipped column
  // may be absent when every remaining file is bundleable.
  const skipped = page.getByTestId("import-skipped-list");
  const skippedRowCount = (await skipped.count())
    ? await skipped.locator(".import-file-row").count()
    : 0;
  console.log(`[preview] skipped rows: ${skippedRowCount}`);

  // Start button must be enabled when a bundle is built.
  await expect(page.getByTestId("import-start")).toBeEnabled();
});

test("redesigned pipeline runs the corpus end-to-end against live core", async ({
  page,
}, testInfo) => {
  // LLM-driven synth/lint can take a while on 18 documents.
  test.setTimeout(20 * 60_000);

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles(collectFiles(CORPUS_ROOT!));
  await expect(page.getByTestId("import-preview")).toBeVisible({
    timeout: 30_000,
  });

  await page.screenshot({
    path: testInfo.outputPath("10-preview.png"),
    fullPage: true,
  });

  // Kick off the pipeline.
  await page.getByTestId("import-start").click();

  // Stepper should mount within seconds.
  await expect(page.getByTestId("import-pipeline")).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: testInfo.outputPath("11-stepper-uploading.png"),
    fullPage: true,
  });

  // Watch for stage transitions by waiting for the meta text on each step.
  // Ingest typically arrives < 30s; synth/lint take longer.
  await page.waitForFunction(
    () => {
      const txt = document.body.textContent ?? "";
      return /committed|已提交/.test(txt);
    },
    { timeout: 5 * 60_000 },
  );
  await page.screenshot({
    path: testInfo.outputPath("12-stepper-ingest-done.png"),
    fullPage: true,
  });

  // Either we land in lint-review (proposals exist) or directly on done.
  const reviewOrDone = page
    .locator('[data-testid="import-lint-review"], [data-testid="import-done"]')
    .first();
  await reviewOrDone.waitFor({ state: "visible", timeout: 15 * 60_000 });

  const isReview = await page
    .getByTestId("import-lint-review")
    .isVisible()
    .catch(() => false);

  if (isReview) {
    await page.screenshot({
      path: testInfo.outputPath("13-lint-review.png"),
      fullPage: true,
    });
    // Apply with the default pick (all selected) so we exercise the full path.
    await page.getByTestId("import-lint-apply").click();
    await expect(page.getByTestId("import-done")).toBeVisible({
      timeout: 10 * 60_000,
    });
  }

  await page.screenshot({
    path: testInfo.outputPath("14-done.png"),
    fullPage: true,
  });

  // Verify the new design's done CTAs are present.
  await expect(page.getByTestId("import-done-open-wiki")).toBeVisible();
  await expect(page.getByTestId("import-done-open-graph")).toBeVisible();
  await expect(page.getByTestId("import-restart")).toBeVisible();
});
