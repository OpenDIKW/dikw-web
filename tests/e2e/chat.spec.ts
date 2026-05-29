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
  await expect(context.getByText("knowledge/concepts/architecture-1.md")).toBeVisible();
  await expect(context.getByText("knowledge/concepts/architecture-2.md")).toBeVisible();
  await expect(context.getByText("retrieve_knowledge")).toHaveCount(2);
});

test("keeps composer action icons visually centered", async ({ page }) => {
  await page.goto("/#chat");
  await page.getByLabel("Message").fill("Center the action icons");

  const measurements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLButtonElement>(".agent-composer > button")).map((button) => {
      const svg = button.querySelector("svg");
      const buttonBox = button.getBoundingClientRect();
      const iconBox = svg?.getBoundingClientRect();
      return {
        label: button.textContent?.trim() ?? "",
        buttonHeight: buttonBox.height,
        buttonWidth: buttonBox.width,
        centerDeltaX: iconBox ? Math.abs(buttonBox.left + buttonBox.width / 2 - (iconBox.left + iconBox.width / 2)) : null,
        centerDeltaY: iconBox ? Math.abs(buttonBox.top + buttonBox.height / 2 - (iconBox.top + iconBox.height / 2)) : null,
        iconHeight: iconBox?.height ?? 0,
        iconWidth: iconBox?.width ?? 0
      };
    });
  });

  expect(measurements).toHaveLength(2);
  for (const measurement of measurements) {
    expect(Math.abs(measurement.buttonWidth - measurement.buttonHeight), measurement.label).toBeLessThanOrEqual(0.5);
    expect(measurement.centerDeltaX, measurement.label).not.toBeNull();
    expect(measurement.centerDeltaY, measurement.label).not.toBeNull();
    expect(measurement.centerDeltaX ?? 99, measurement.label).toBeLessThanOrEqual(0.5);
    expect(measurement.centerDeltaY ?? 99, measurement.label).toBeLessThanOrEqual(0.5);
    expect(measurement.iconWidth, measurement.label).toBeGreaterThanOrEqual(14);
    expect(measurement.iconHeight, measurement.label).toBeGreaterThanOrEqual(14);
  }
});

test("keeps chat output panels pinned to the newest content by default", async ({ page }) => {
  await page.goto("/#chat");

  await page.getByLabel("Message").fill("auto-scroll stress");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByTestId("agent-conversation-scroll").getByText("Auto scroll line 1-48: evidence-backed chat output keeps growing.")
  ).toBeVisible();
  await expect(page.getByText("knowledge/concepts/auto-scroll-source-24.md")).toBeVisible();
  await expect(page.getByText("retrieve_knowledge_24")).toBeVisible();

  await expect.poll(() => panelMetrics(page, ".agent-conversation-scroll")).toMatchObject({ hasOverflow: true, nearBottom: true });
  await expect.poll(() => panelMetrics(page, ".citation-list")).toMatchObject({ hasOverflow: true, nearBottom: true });
  await expect.poll(() => panelMetrics(page, ".tool-call-list")).toMatchObject({ hasOverflow: true, nearBottom: true });
});

test("resets chat output panels to sticky bottom on the next user message", async ({ page }) => {
  await page.goto("/#chat");

  await page.getByLabel("Message").fill("auto-scroll stress first");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByTestId("agent-conversation-scroll").getByText("Auto scroll line 1-48: evidence-backed chat output keeps growing.")
  ).toBeVisible();
  await expect.poll(() => panelMetrics(page, ".agent-conversation-scroll")).toMatchObject({ hasOverflow: true, nearBottom: true });

  for (const selector of [".agent-conversation-scroll", ".citation-list", ".tool-call-list"]) {
    await page.locator(selector).evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(() => panelMetrics(page, selector)).toMatchObject({ hasOverflow: true, nearBottom: false });
  }

  await page.getByLabel("Message").fill("auto-scroll stress second");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByTestId("agent-conversation-scroll").getByText("Auto scroll line 2-48: evidence-backed chat output keeps growing.")
  ).toBeVisible();

  await expect.poll(() => panelMetrics(page, ".agent-conversation-scroll")).toMatchObject({ hasOverflow: true, nearBottom: true });
  await expect.poll(() => panelMetrics(page, ".citation-list")).toMatchObject({ hasOverflow: true, nearBottom: true });
  await expect.poll(() => panelMetrics(page, ".tool-call-list")).toMatchObject({ hasOverflow: true, nearBottom: true });
});

async function panelMetrics(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return {
      hasOverflow: element.scrollHeight > element.clientHeight + 4,
      nearBottom: distanceToBottom <= 4,
      distanceToBottom
    };
  });
}
