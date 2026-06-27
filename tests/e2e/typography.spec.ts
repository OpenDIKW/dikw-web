import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

// Guards the type-role cascade base (DESIGN.md §3): `body` sets
// `font-size: var(--type-body-size)` so the base is the body role, not the 16px
// browser default. Without it, every unsized element — and every `font: inherit`
// control (buttons/inputs/selects) — silently renders off the six-role scale.
test("the cascade base is the body type-role token, not the 16px UA default", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  // Assert the mechanism (body rides the --type-body-size token), not the literal
  // px, so a deliberate token retune doesn't false-fail this guard.
  const { bodyFs, tokenFs } = await page.evaluate(() => ({
    bodyFs: getComputedStyle(document.body).fontSize,
    tokenFs: getComputedStyle(document.documentElement).getPropertyValue("--type-body-size").trim(),
  }));
  expect(bodyFs).toBe(tokenFs);
  // Sanity: it really is below the 16px UA default this change replaces.
  expect(parseFloat(bodyFs)).toBeLessThan(16);

  // The motivating behavior: `font: inherit` controls ride the base. A sidebar
  // nav button carries no own font-size, so it must match the body base — if the
  // `font: inherit` rule regresses, the button falls back to the UA control font
  // (~13px) and this fails.
  const navButton = page.locator(".nav-item").first();
  await expect(navButton).toBeVisible();
  const navButtonFs = await navButton.evaluate((el) => getComputedStyle(el).fontSize);
  expect(navButtonFs).toBe(bodyFs);

  // An unsized panel value inherits the base too — this catches a subtree that
  // re-establishes 16px between body and content, which the body check can't.
  const firstDetailValue = page.locator(".detail-list dd").first();
  await expect(firstDetailValue).toBeVisible();
  const ddFs = await firstDetailValue.evaluate((el) => getComputedStyle(el).fontSize);
  expect(ddFs).toBe(bodyFs);
});
