import { expect, test } from "./harness";
import { mockDikwApi, mockTraceApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
  await mockTraceApi(page);
});

test("#trace is reachable by URL but stays hidden from the sidebar", async ({ page }) => {
  await page.goto("/#trace");

  await expect(page).toHaveURL(/#trace$/);
  await expect(page.getByRole("heading", { name: "Trace" })).toBeVisible();

  // Hidden route: the sidebar nav renders normally but must NOT offer Trace.
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(sidebar.getByText("Trace")).toHaveCount(0);

  // The waterfall renders live spans from the /agent/sessions/*/traces fixture.
  const trace = page.getByRole("region", { name: "Trace" });
  await expect(trace.getByText("execute_tool retrieve_knowledge")).toBeVisible();
  await expect(trace.getByText("call_llm")).toBeVisible();
});

test("#trace shows a session conversation and switches sessions", async ({ page }) => {
  await page.goto("/#trace");

  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText(/DIKW stacks data/)).toBeVisible();

  await page.getByRole("button", { name: /List the wisdom items/ }).click();
  await expect(conversation.getByText(/3 wisdom items/)).toBeVisible();
  const trace = page.getByRole("region", { name: "Trace" });
  await expect(trace.getByText("execute_tool list_wisdom")).toBeVisible();
});
