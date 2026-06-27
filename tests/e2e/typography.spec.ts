import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

// Guards the type-role base: the cascade base font-size is the body role (15px),
// not the 16px browser default. Without this, every unsized element — and every
// `font: inherit` control (buttons, inputs, selects) — silently renders at 16px,
// off the six-role scale. See DESIGN.md §3.
test("the base font-size is the body type role, not the 16px UA default", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  const bodyFontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(bodyFontSize).toBe("15px");

  // Panel detail values are unsized, so they inherit the base — they must ride 15px.
  const firstDetailValue = page.locator(".detail-list dd").first();
  await expect(firstDetailValue).toBeVisible();
  const ddFontSize = await firstDetailValue.evaluate((el) => getComputedStyle(el).fontSize);
  expect(ddFontSize).toBe("15px");
});
