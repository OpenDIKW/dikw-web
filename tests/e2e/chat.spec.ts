import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("opens chat, renames a session, reopens history, and keeps legacy query redirects", async ({ page }) => {
  await page.goto("/#chat");

  await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Chat history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename chat New chat" })).toBeVisible();

  await page.getByRole("button", { name: "Rename chat New chat" }).click();
  await page.getByLabel("Chat title").fill("Project Review");
  await page.getByRole("button", { name: "Save title" }).click();

  await expect(page.getByRole("button", { name: "Rename chat Project Review" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Project Review")).toBeVisible();

  await page.goto("/#query");
  await expect(page).toHaveURL(/#chat$/);

  await page.getByLabel("Message").fill("What is DIKW?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("agent-conversation-scroll").getByText("Layered answer.", { exact: true })).toBeVisible();
});

test("keeps reply context in the same scroll container as the conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/#chat");

  for (let index = 0; index < 10; index += 1) {
    await page.getByLabel("Message").fill(`Question ${index + 1}`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Layered answer.").last()).toBeVisible();
  }

  const scrollRegion = page.getByTestId("agent-conversation-scroll");
  await expect(scrollRegion).toBeVisible();
  await expect(scrollRegion.getByText("Sources")).toBeVisible();
  await expect(scrollRegion.getByText("Tool calls")).toBeVisible();

  const structure = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="agent-conversation-scroll"]');
    const context = document.querySelector(".agent-context");
    const composer = document.querySelector(".agent-composer");
    return {
      contextInsideScroll: Boolean(scroll && context && scroll.contains(context)),
      composerInsideScroll: Boolean(scroll && composer && scroll.contains(composer))
    };
  });
  expect(structure).toEqual({ contextInsideScroll: true, composerInsideScroll: false });

  await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByLabel("Message")).toBeVisible();
});

test("keeps the reply context rail content-sized instead of stretching across the chat canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1660, height: 920 });
  await page.goto("/#chat");

  const layout = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="agent-conversation-scroll"]');
    const context = document.querySelector(".agent-context");
    if (!scroll || !context) {
      return null;
    }
    const scrollRect = scroll.getBoundingClientRect();
    const contextRect = context.getBoundingClientRect();
    return {
      scrollHeight: scrollRect.height,
      contextHeight: contextRect.height
    };
  });

  expect(layout).not.toBeNull();
  expect(layout!.contextHeight).toBeLessThan(layout!.scrollHeight * 0.8);
});
