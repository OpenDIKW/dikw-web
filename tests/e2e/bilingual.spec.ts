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
  const toggle = page.getByRole("button", { name: TOGGLE });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const cols = page.locator(".bilingual-cols");
  await expect(cols).toBeVisible();
  await expect(reader.getByText("Source · EN")).toBeVisible();
  await expect(reader.getByText("Chinese · AI")).toBeVisible();
  // Translation resolves and the right column shows the Chinese text.
  await expect(
    reader
      .locator(".bi-block--tr")
      .getByText(/中文译文/)
      .first(),
  ).toBeVisible();

  // Toggling off returns to the single-column reader.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".bilingual-cols")).toHaveCount(0);
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();
});

test("keeps the dual-column view readable in dark mode", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dikw-web.theme", "dark");
  });
  await page.goto("/#base");
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader.getByText(/Layered DIKW notes/)).toBeVisible();

  await page.getByRole("button", { name: TOGGLE }).click();
  await expect(page.locator(".bilingual-cols")).toBeVisible();
  await expect(
    reader
      .locator(".bi-block--tr")
      .getByText(/中文译文/)
      .first(),
  ).toBeVisible();
});
