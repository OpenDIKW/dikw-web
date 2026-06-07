import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("loads eval task events and keeps raw JSON collapsed", async ({ page }) => {
  await page.goto("/#tasks");

  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.locator(".eval-dataset-line strong", { hasText: "synthetic-diverse-v1" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Load events/ }).click();
  await expect(page.getByText("4 events")).toBeVisible();
  await expect(page.getByText("#4")).toBeVisible();
  await expect(page.getByText("Raw final event")).toBeVisible();

  const rawFinal = page.locator("details").filter({ hasText: "Raw final event" });
  await expect(rawFinal).not.toHaveAttribute("open", "");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
});

test("paginates a task event tape with 25 events", async ({ page }) => {
  await page.goto("/#tasks");

  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await page.getByText("events-bulk-1").click();
  await page.getByRole("button", { name: /Load events/ }).click();

  await expect(page.getByText("25 events")).toBeVisible();
  const tape = page.locator(".event-section").filter({ hasText: "Event tape" });
  await expect(tape.getByRole("navigation", { name: "event pagination" })).toBeVisible();
  await expect(tape.getByText(/Page\s*1\s*\/\s*2/)).toBeVisible();
  await expect(tape.locator(".event-tape__meta span", { hasText: /^#1$/ })).toBeVisible();
  await expect(tape.locator(".event-tape__meta span", { hasText: /^#21$/ })).toHaveCount(0);
  await expect(tape.getByRole("button", { name: /Prev/i })).toBeDisabled();

  await tape.getByRole("button", { name: /Next/i }).click();
  await expect(tape.getByText(/Page\s*2\s*\/\s*2/)).toBeVisible();
  await expect(tape.locator(".event-tape__meta span", { hasText: /^#21$/ })).toBeVisible();
  await expect(tape.locator(".event-tape__meta span", { hasText: /^#25$/ })).toBeVisible();
  await expect(tape.locator(".event-tape__meta span", { hasText: /^#1$/ })).toHaveCount(0);
  await expect(tape.getByRole("button", { name: /Next/i })).toBeDisabled();
});
