import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { mockDikwApi } from "./mockApi";

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

// Guards the type-role cascade base (DESIGN.md §3): `body` sets
// `font-size: var(--type-body-size)` so the base is the body role, not the 16px
// browser default. Without it, every unsized element — and every `font: inherit`
// control (buttons/inputs/selects) — silently renders off the six-role scale.
test("the cascade base is the body type-role token, not the 16px UA default", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  // Assert the mechanism (body rides the --type-body-size token), not the literal
  // px, so a deliberate token retune doesn't false-fail this guard.
  const { bodyFs, tokenFs } = await page.evaluate(() => ({
    bodyFs: getComputedStyle(document.body).fontSize,
    tokenFs: getComputedStyle(document.documentElement).getPropertyValue("--type-body-size").trim(),
  }));
  expect(bodyFs).toBe(tokenFs);
  // Sanity: it really is below the 16px UA default this change replaces.
  expect(parseFloat(bodyFs)).toBeLessThan(16);

  // The motivating behavior: `font: inherit` controls ride the base. A sidebar
  // nav button carries no own font-size, so it must match the body base — if the
  // `font: inherit` rule regresses, the button falls back to the UA control font
  // (~13px) and this fails.
  const navButton = page.locator(".nav-item").first();
  await expect(navButton).toBeVisible();
  const navButtonFs = await navButton.evaluate((el) => getComputedStyle(el).fontSize);
  expect(navButtonFs).toBe(bodyFs);

  // An unsized panel value inherits the base too — this catches a subtree that
  // re-establishes 16px between body and content, which the body check can't.
  const firstDetailValue = page.locator(".detail-list dd").first();
  await expect(firstDetailValue).toBeVisible();
  const ddFs = await firstDetailValue.evaluate((el) => getComputedStyle(el).fontSize);
  expect(ddFs).toBe(bodyFs);
});

// The three voices resolve to the IBM Plex superfamily (DESIGN.md §3). Asserts the
// declared `--font-*` token stacks + the body's resolved family — `getComputedStyle`
// returns the CSS-declared stack whether or not the webfont actually downloaded, so
// this is robust even when Google Fonts is unreachable in CI.
test("the three type voices resolve to the IBM Plex superfamily", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();

  const fonts = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      ui: cs.getPropertyValue("--font-ui").trim(),
      serif: cs.getPropertyValue("--font-serif").trim(),
      mono: cs.getPropertyValue("--font-mono").trim(),
      bodyFamily: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(fonts.ui).toContain("IBM Plex Sans");
  expect(fonts.serif).toContain("IBM Plex Serif");
  expect(fonts.mono).toContain("IBM Plex Mono");
  // The sans voice actually reaches the body, not just the token.
  expect(fonts.bodyFamily).toContain("IBM Plex Sans");
});

// Sweeps every rendered leaf text element and returns the info for any that breaks
// the named invariant — empty array means the page complies. The predicate is a
// fixed discriminator (not interpolated code) so it runs safely in the page.
async function sweepText(page: Page, kind: "tracked-uppercase" | "below-floor") {
  return page.evaluate((k) => {
    const breaks = (cs: CSSStyleDeclaration) => {
      if (k === "below-floor") {
        // `font-size: 0` is a deliberate icon-button label-collapse (e.g. the chat
        // composer Send button), not a legibility floor breach — exclude it.
        const fs = parseFloat(cs.fontSize);
        return fs > 0 && fs < 11;
      }
      // tracked-uppercase: uppercase + real letter-spacing, in a non-mono voice
      return (
        cs.textTransform === "uppercase" &&
        cs.letterSpacing !== "normal" &&
        parseFloat(cs.letterSpacing) !== 0 &&
        !cs.fontFamily.includes("IBM Plex Mono")
      );
    };
    const out: Array<{ tag: string; cls: string; fs: string; ff: string; tt: string; ls: string }> =
      [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      if (el.children.length > 0) continue; // leaf elements only
      if (!(el.textContent || "").trim()) continue; // with visible text
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // actually rendered
      const cs = getComputedStyle(el);
      if (breaks(cs)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className.toString().slice(0, 48),
          fs: cs.fontSize,
          ff: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
          tt: cs.textTransform,
          ls: cs.letterSpacing,
        });
      }
    }
    return out;
  }, kind);
}

// Routes the invariants sweep — chosen to cover the surfaces this scale pass
// actually touched (global chrome, reader, import, chat), not just #overview.
const SWEEP_ROUTES = ["#overview", "#base", "#import", "#chat"] as const;

async function gotoAndSettle(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  // The sidebar nav renders on every workbench route — a reliable cross-route
  // "shell is up" signal without coupling to a per-route heading.
  await expect(page.locator(".nav-item").first()).toBeVisible();
}

// The Mono-Only-Uppercase Rule (DESIGN.md §3): tracked uppercase is permitted only
// in the IBM Plex Mono label voice. This invariant catches ANY sans/serif element
// that renders uppercase + letter-spacing — far more durable than per-selector
// literals, and exactly the AI "eyebrow" tell the rule forbids.
test("no sans/serif element renders tracked uppercase (Mono-Only-Uppercase)", async ({ page }) => {
  for (const route of SWEEP_ROUTES) {
    await gotoAndSettle(page, route);
    const offenders = await sweepText(page, "tracked-uppercase");
    expect(offenders, `${route}: ${JSON.stringify(offenders, null, 2)}`).toHaveLength(0);
  }
});

// The 11px floor (DESIGN.md §3): nothing renders below the label size, for
// low-vision legibility. Catches a reintroduced 10.5px label.
test("no rendered text drops below the 11px floor", async ({ page }) => {
  for (const route of SWEEP_ROUTES) {
    await gotoAndSettle(page, route);
    const tooSmall = await sweepText(page, "below-floor");
    expect(tooSmall, `${route}: ${JSON.stringify(tooSmall, null, 2)}`).toHaveLength(0);
  }
});

// Panel titles ride the `title` role token (17px), not the old off-scale 14px.
// Asserts the mechanism (the token) so a deliberate retune doesn't false-fail.
test("panel titles ride the title-role token", async ({ page }) => {
  await page.goto("/#overview");
  const panelTitle = page.locator(".panel__title").first();
  await expect(panelTitle).toBeVisible();
  const { titleFs, tokenFs } = await page.evaluate(() => {
    const el = document.querySelector(".panel__title")!;
    return {
      titleFs: getComputedStyle(el).fontSize,
      tokenFs: getComputedStyle(document.documentElement)
        .getPropertyValue("--type-title-size")
        .trim(),
    };
  });
  expect(titleFs).toBe(tokenFs);
});
