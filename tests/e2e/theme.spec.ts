import { expect, test } from "@playwright/test";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("dikw-web.theme", "dark");
  });
});

test("dark Wiki reader uses low-glare surfaces with readable contrast", async ({ page }) => {
  await page.goto("/#wiki");

  const reader = page.locator(".wiki-reader");
  await expect(reader).toBeVisible();
  await expect(reader.locator(".markdown-body")).toBeVisible();

  const contrastChecks = await page.evaluate(() => {
    const selectors = [
      { selector: ".markdown-body p", label: "paragraph", minimum: 4.5 },
      { selector: ".markdown-body h1", label: "heading", minimum: 3 },
      { selector: ".markdown-body code", label: "inline code", minimum: 4.5 },
      { selector: ".markdown-body blockquote", label: "blockquote", minimum: 4.5 },
      { selector: ".markdown-table-wrap td", label: "table cell", minimum: 4.5 },
      { selector: ".wiki-reader-tabs button", label: "reader tab", minimum: 3 },
      { selector: ".reader-header__path", label: "reader metadata", minimum: 3 }
    ];

    return selectors.map(({ selector, label, minimum }) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        return { label, selector, ratio: 0, minimum, missing: true };
      }
      return {
        label,
        selector,
        ratio: contrastRatio(readColor(getComputedStyle(element).color), effectiveBackground(element)),
        minimum,
        missing: false
      };
    });

    function effectiveBackground(element: HTMLElement): [number, number, number] {
      let current: HTMLElement | null = element;
      while (current) {
        const color = readColor(getComputedStyle(current).backgroundColor);
        if (color[3] > 0) {
          return color;
        }
        current = current.parentElement;
      }
      return readColor(getComputedStyle(document.body).backgroundColor);
    }

    function readColor(value: string): [number, number, number, number] {
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value);
      if (!match) {
        return [0, 0, 0, 0];
      }
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
    }

    function contrastRatio(foreground: [number, number, number, number], background: [number, number, number, number]): number {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    }

    function luminance(color: [number, number, number, number]): number {
      const [r, g, b] = color.map((part) => part / 255);
      const [rl, gl, bl] = [r, g, b].map((part) => (part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4));
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
  });

  for (const check of contrastChecks) {
    expect(check, `${check.label} should exist`).toMatchObject({ missing: false });
    expect(check.ratio, `${check.label} contrast`).toBeGreaterThanOrEqual(check.minimum);
  }

  const nearWhiteBackgrounds = await page.locator(".wiki-reader *").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(style.backgroundColor);
        if (!match || match[4] === "0") {
          return null;
        }
        const rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
        return rgb.every((part) => part >= 235)
          ? {
              tag: element.tagName.toLowerCase(),
              className: String((element as HTMLElement).className),
              color: style.backgroundColor
            }
          : null;
      })
      .filter(Boolean)
  );
  expect(nearWhiteBackgrounds).toEqual([]);

  const screenshot = await reader.screenshot();
  expect(screenshot.length).toBeGreaterThan(1000);
});
