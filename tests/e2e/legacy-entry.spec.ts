import { test, expect } from "./harness";
import { mockDikwApi } from "./mockApi";

test("isolates the local backup document from pending workbench authentication", async ({
  page,
}) => {
  await mockDikwApi(page);
  let probes = 0;
  let replies = 0;
  let loginRequests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/web/auth/me", async (route) => {
    probes++;
    await held;
    await route.fulfill({ status: 401, json: {} }).catch(() => {});
    replies++;
  });
  await page.route("**/web/auth/login?*", (route) => {
    loginRequests++;
    return route.fulfill({ contentType: "text/html", body: "<h1>Unexpected sign in</h1>" });
  });
  try {
    await page.goto("/#overview");
    await expect.poll(() => probes).toBe(2);
    await page.evaluate(() => {
      Object.assign(window, { legacyProbeFixture: true });
      location.hash = "MB-Web";
    });
    await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
    // Intercepted requests do not report a network failure after reload. Assert
    // that the old probe's document/global state is discarded instead.
    expect(await page.evaluate(() => "legacyProbeFixture" in window)).toBe(false);
    // Release before the probe's own timeout; its eventual timer cancellation
    // must not be mistaken for cancellation at the route boundary.
    release();
    await expect.poll(() => replies).toBe(2);
    expect(probes).toBe(2);
    await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
    expect(loginRequests).toBe(0);
  } finally {
    release();
  }
});

test("keeps the legacy export available when authentication is unavailable", async ({ page }) => {
  await mockDikwApi(page);
  let authRequests = 0;
  await page.route("**/web/auth/me", async (route) => {
    authRequests++;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#MB-Web");
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出旧笔记与论文别名" })).toBeVisible();
  await expect(page.getByText(/新应用地址尚未配置/)).toBeVisible();
  await expect(page.getByRole("button", { name: "上传论文" })).toHaveCount(0);
  expect(authRequests).toBe(0);
});

test("opens only the configured destination without forwarding legacy URL state", async ({
  page,
}) => {
  await mockDikwApi(page);
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: { mbWebUrl: "https://papers.example.com/research" },
    }),
  );
  await page.goto("/?old-secret=fixture#MB-Web");
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开新迈博应用" })).toHaveAttribute(
    "href",
    "https://papers.example.com/research",
  );
  await expect(page.getByRole("button", { name: "导出旧笔记与论文别名" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传论文" })).toHaveCount(0);
});

test("loads workbench authentication when leaving the legacy entry", async ({ page }) => {
  await mockDikwApi(page);
  let authRequests = 0;
  await page.route("**/web/auth/me", async (route) => {
    authRequests++;
    await route.fulfill({ json: { enabled: false } });
  });
  await page.goto("/#/mb-web");
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  expect(authRequests).toBe(0);
  await page.evaluate(() => {
    location.hash = "overview";
  });
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  expect(authRequests).toBeGreaterThan(0);
  await page.evaluate(() => {
    location.hash = "MB-Web";
  });
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(0);
});

test("keeps the workbench closed when its authentication probe is unavailable", async ({
  page,
}) => {
  await mockDikwApi(page);
  await page.route("**/web/auth/me", (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto("/#MB-Web");
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "overview";
  });
  await expect(page.getByText("Can't reach the server", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "迈博应用已迁移" })).toHaveCount(0);
});
