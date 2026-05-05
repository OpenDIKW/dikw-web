import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("reads a wiki page and follows a wikilink", async ({ page }) => {
  await page.goto("/#wiki");

  await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();
  await expect(page.getByText("Layered DIKW notes.")).toBeVisible();

  await page.getByRole("button", { name: "Synthesis", exact: true }).click();
  await expect(page.getByText("Synthesis Body.")).toBeVisible();
});
