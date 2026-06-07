import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("renders web_search results as Sources with external links and shows both tool calls", async ({
  page,
}) => {
  await page.goto("/#chat");

  await page.getByLabel("Message").fill("web tools demo");
  await page.getByRole("button", { name: "Send" }).click();

  const context = page.getByRole("complementary", { name: "Session context" });
  const conversation = page.getByTestId("agent-conversation-scroll");

  await expect(
    conversation.getByText("Found two web sources and fetched one page.", { exact: true }),
  ).toBeVisible();

  const linkA = context.getByRole("link", { name: "https://example.com/a" });
  await expect(linkA).toHaveAttribute("href", "https://example.com/a");
  await expect(linkA).toHaveAttribute("target", "_blank");
  await expect(linkA).toHaveAttribute("rel", /noopener/);

  const linkB = context.getByRole("link", { name: "https://example.com/b" });
  await expect(linkB).toHaveAttribute("target", "_blank");

  await expect(context.getByText("Web").first()).toBeVisible();
  await expect(context.getByText("external snippet a")).toBeVisible();

  await expect(context.getByText("web_search")).toBeVisible();
  await expect(context.getByText("web_fetch")).toBeVisible();
});

test("keeps web source contrast readable in dark theme", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dikw-web.theme", "dark");
  });
  await page.goto("/#chat");

  await page.getByLabel("Message").fill("web tools demo");
  await page.getByRole("button", { name: "Send" }).click();

  const context = page.getByRole("complementary", { name: "Session context" });
  const link = context.getByRole("link", { name: "https://example.com/a" });
  await expect(link).toBeVisible();

  const sample = await link.evaluate((el) => {
    const styles = getComputedStyle(el);
    return { color: styles.color };
  });
  const match = sample.color.match(/rgba?\(([^)]+)\)/);
  expect(match, `expected rgb color, got ${sample.color}`).not.toBeNull();
  const [r, g, b] = match![1].split(",").map((value) => Number(value.trim()));
  expect(r + g + b).toBeGreaterThan(255);
});
