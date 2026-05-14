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
  await expect(page.getByRole("button", { name: "New chat options" })).toBeVisible();

  await page.getByRole("button", { name: "New chat options" }).click();
  await page.getByRole("menuitem", { name: "Rename chat" }).click();
  await page.getByLabel("Chat title").fill("Project Review");
  await page.getByRole("button", { name: "Save title" }).click();

  await expect(page.getByRole("button", { name: "Project Review options" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Project Review")).toBeVisible();

  await page.goto("/#query");
  await expect(page).toHaveURL(/#chat$/);

  await page.getByLabel("Message").fill("What is DIKW?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("agent-conversation-scroll").getByText("Layered answer.", { exact: true })).toBeVisible();
});

test("keeps session context outside the conversation scroll container", async ({ page }) => {
  await page.goto("/#chat");

  const scrollRegion = page.getByTestId("agent-conversation-scroll");
  await expect(scrollRegion).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Session context" }).getByText("Sources", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Session context" }).getByText("Tool calls", { exact: true })).toBeVisible();

  const structure = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="agent-conversation-scroll"]');
    const context = document.querySelector(".agent-context");
    const composer = document.querySelector(".agent-composer");
    return {
      contextInsideScroll: Boolean(scroll && context && scroll.contains(context)),
      composerInsideScroll: Boolean(scroll && composer && scroll.contains(composer))
    };
  });
  expect(structure).toEqual({ contextInsideScroll: false, composerInsideScroll: false });
  await expect(page.getByLabel("Message")).toBeVisible();
});

test("shows session-level sources and tool calls across replies", async ({ page }) => {
  await page.goto("/#chat");

  await page.getByLabel("Message").fill("First question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Layered answer.").last()).toBeVisible();
  await page.getByLabel("Message").fill("Second question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Layered answer.").last()).toBeVisible();

  const context = page.getByRole("complementary", { name: "Session context" });
  await expect(context.getByText("wiki/concepts/architecture-1.md")).toBeVisible();
  await expect(context.getByText("wiki/concepts/architecture-2.md")).toBeVisible();
  await expect(context.getByText("retrieve_knowledge")).toHaveCount(2);
});
