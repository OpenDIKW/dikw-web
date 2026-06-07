import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

// Deterministic layout-shift budget for the primary routes. CLS is the one Core
// Web Vital that is stable under headless Chromium with mocked, instant /v1 data,
// so it is the only HARD gate here. Render-timing vitals (LCP) and main-thread
// blocking (long tasks) are runner-dependent, so they are measured and surfaced
// as annotations for visibility but never fail CI — same reasoning that keeps
// `smoke:core` out of CI. See docs/tdd.md.
//
// 0.1 is the CWV "good" threshold. With mocked data the app should shift far
// less; the budget guards a regression that introduces unreserved space (a late
// banner, an unsized image/asset, a font swap) on a primary route.
const CLS_BUDGET = 0.1;

const ROUTES = ["overview", "base", "graph", "tasks", "chat", "wisdom"];

type PerfMetrics = { cls: number; lcp: number; longtask: number };

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
  // Install observers before any page script runs so buffered entries from the
  // initial paint are captured. Each observer is isolated so an unsupported
  // entryType can never suppress the gated CLS metric.
  await page.addInitScript(() => {
    const store = window as unknown as PerfMetrics;
    store.cls = 0;
    store.lcp = 0;
    store.longtask = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) store.cls += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift unsupported — leave cls at 0.
    }
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) store.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // largest-contentful-paint unsupported — soft metric only.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.longtask += entry.duration;
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // longtask unsupported — soft metric only.
    }
  });
});

for (const route of ROUTES) {
  test(`#${route} stays within the layout-shift budget`, async ({ page }, testInfo) => {
    // Generous timeout: a cold Vite dev server compiling on the first wave of
    // concurrent navigations can exceed the default 30s; warm runs take ~2s.
    test.setTimeout(60_000);
    await page.goto(`/#${route}`, { waitUntil: "domcontentloaded" });
    // Wait for content to render, then let late shifts (async data, fonts)
    // settle. /v1 is mocked and instant, so a short settle is sufficient.
    await page.getByRole("heading").first().waitFor({ state: "visible" });
    await page.waitForTimeout(700);

    const metrics = await page.evaluate(() => {
      const store = window as unknown as PerfMetrics;
      return { cls: store.cls, lcp: store.lcp, longtask: store.longtask };
    });

    testInfo.annotations.push({
      type: "perf",
      description: `#${route} CLS=${metrics.cls.toFixed(4)} LCP=${Math.round(
        metrics.lcp,
      )}ms longtask=${Math.round(metrics.longtask)}ms`,
    });

    expect(
      metrics.cls,
      `#${route} cumulative layout shift ${metrics.cls.toFixed(4)} exceeds budget ${CLS_BUDGET}`,
    ).toBeLessThanOrEqual(CLS_BUDGET);
  });
}
