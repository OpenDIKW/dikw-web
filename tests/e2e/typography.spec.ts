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
async function sweepText(page: Page, kind: "tracked-uppercase" | "below-floor" | "off-scale") {
  return page.evaluate((k) => {
    // The role + editorial sub-scale (DESIGN.md §3): label 11 / body-sm 13 /
    // body 15 / title 17 / stat 18 / reader-h2 22 / hero 27 / title-page 30 /
    // display 32. Every UI text size must land on one of these; 12/14/16 are the
    // off-scale drift this guard forbids.
    const SCALE = [11, 13, 15, 17, 18, 22, 27, 30, 32];
    const breaks = (cs: CSSStyleDeclaration, el: HTMLElement) => {
      if (k === "below-floor") {
        // `font-size: 0` is a deliberate icon-button label-collapse (e.g. the chat
        // composer Send button), not a legibility floor breach — exclude it.
        const fs = parseFloat(cs.fontSize);
        return fs > 0 && fs < 11;
      }
      if (k === "off-scale") {
        const fs = parseFloat(cs.fontSize);
        if (!(fs > 0)) return false;
        // Relative/notation contexts are intentionally em-scaled, not bound to the
        // UI role ladder: inline/block code (0.92em), KaTeX math sub/superscripts +
        // struts, and the missing-asset placeholder (0.9em). Exempt the elements and
        // any descendants.
        if (el.closest("code, pre, kbd, samp, .katex, .katex-display, .md-broken-image"))
          return false;
        return !SCALE.some((s) => Math.abs(s - fs) < 0.5);
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
      if (breaks(cs, el)) {
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
const SWEEP_ROUTES = [
  "#overview",
  "#base",
  "#import",
  "#chat",
  "#settings",
  "#tasks",
  "#wisdom",
] as const;

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

// Scale-adherence invariant (DESIGN.md §3): every rendered UI text leaf must land
// on the role/editorial ladder {11,13,15,17,18,22,27,30,32}. Primarily guards the
// small-text band (11–17) — it catches a reintroduced off-scale size (12/14/16),
// the drift the post-v0.8.0 consolidation removed. Code, KaTeX math and the
// missing-asset placeholder are em-relative notation, deliberately exempt. NOTE:
// this is a passive, default-viewport sweep — it does not open modals/popovers or
// exercise @media breakpoints, so any size that surfaces only there is out of its
// reach (see DESIGN.md §3).
test("no UI text renders off the role scale", async ({ page }) => {
  for (const route of SWEEP_ROUTES) {
    await gotoAndSettle(page, route);
    const offenders = await sweepText(page, "off-scale");
    expect(offenders, `${route}: ${JSON.stringify(offenders, null, 2)}`).toHaveLength(0);
  }
});

// Type-system contracts for surfaces the passive sweeps can't reach. The
// invariant sweeps above only see what renders on a default-viewport, no-auth,
// no-interaction load — so the frontmatter info-grid (a tab behind a page read),
// the wikilink preview card (hover-gated), the bilingual column heads + import
// step markers + #trace duration (state-gated) all slip past them while their
// CSS still drifts. This guard injects each selector's minimal DOM so the
// stylesheet's own rule is asserted directly, independent of app data.
test("type-system rules hold on sweep-unreachable surfaces (workbench)", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.locator(".nav-item").first()).toBeVisible();

  const probes = await page.evaluate(() => {
    const cases: Array<{ id: string; html: string; target: string }> = [
      // Hero metric value: the documented hero-number is 27 (DESIGN.md §3), not
      // the 30 a token-migration override had silently pinned.
      {
        id: "metricValue",
        html: `<div class="metric-card__value">42</div>`,
        target: ".metric-card__value",
      },
      // Frontmatter field label — every other field dt is the mono label voice.
      {
        id: "infoDt",
        html: `<dl class="wiki-info-grid"><dt>layer</dt><dd>x</dd></dl>`,
        target: ".wiki-info-grid dt",
      },
      // Wikilink preview eyebrow — an uppercase label, so Mono-Only-Uppercase.
      {
        id: "previewHeader",
        html: `<div class="wiki-preview__header">preview</div>`,
        target: ".wiki-preview__header",
      },
      // Bilingual column head: mono has no 600 face, so 600 was a dead no-op.
      {
        id: "biColhead",
        html: `<div class="bi-colhead"><span>Source</span></div>`,
        target: ".bi-colhead span",
      },
      {
        id: "importMarker",
        html: `<div class="import-step__marker">1</div>`,
        target: ".import-step__marker",
      },
      {
        id: "traceDur",
        html: `<div class="trace-invocation__dur">5ms</div>`,
        target: ".trace-invocation__dur",
      },
      // User markdown table headers must render verbatim, not force-uppercased.
      {
        id: "tableTh",
        html: `<div class="markdown-table-wrap"><table><thead><tr><th>Name</th></tr></thead></table></div>`,
        target: ".markdown-table-wrap th",
      },
      // Dialog H2 must ride the title role (sans 600), not inherit the UA bold 700.
      {
        id: "wisdomDialogH2",
        html: `<div class="wisdom-dialog__header"><h2>Title</h2></div>`,
        target: ".wisdom-dialog__header h2",
      },
      // Chart caption must land on the role ladder (body-sm), not an off-scale em.
      {
        id: "chartCaption",
        html: `<figure class="markdown-chart"><figcaption class="markdown-chart__caption">cap</figcaption></figure>`,
        target: ".markdown-chart__caption",
      },
    ];
    const out: Record<string, { ff: string; fw: string; tt: string; fs: string }> = {};
    for (const c of cases) {
      const holder = document.createElement("div");
      holder.innerHTML = c.html;
      document.body.appendChild(holder);
      const el = holder.querySelector(c.target)!;
      const cs = getComputedStyle(el);
      out[c.id] = { ff: cs.fontFamily, fw: cs.fontWeight, tt: cs.textTransform, fs: cs.fontSize };
      holder.remove();
    }
    const bodySm = getComputedStyle(document.documentElement)
      .getPropertyValue("--type-body-sm-size")
      .trim();
    return { out, bodySm };
  });

  const { out, bodySm } = probes;
  // A — hero metric is the documented 27px, not the drifted 30px. (The 22px
  // override lives at ≤640px, so this holds at the runner's default wide
  // viewport — the surface this guard targets.)
  expect(out.metricValue.fs).toBe("27px");
  // B/C — uppercase eyebrows render in the mono voice (Mono-Only-Uppercase).
  expect(out.infoDt.ff).toContain("IBM Plex Mono");
  expect(out.previewHeader.ff).toContain("IBM Plex Mono");
  expect(out.previewHeader.fw).toBe("500");
  // D/E/F — mono labels declare a loaded weight (500), not the no-op 600.
  expect(out.biColhead.fw).toBe("500");
  expect(out.importMarker.fw).toBe("500");
  expect(out.traceDur.fw).toBe("500");
  // G — user table headers are not transformed (content fidelity).
  expect(out.tableTh.tt).toBe("none");
  // I — dialog H2 rides the title role weight (600), not UA bold.
  expect(out.wisdomDialogH2.fw).toBe("600");
  // J — chart caption is on the role ladder.
  expect(out.chartCaption.fs).toBe(bodySm);
});

// The MB-Web bilingual column heads are the twin of the workbench `.bi-colhead`
// (which is mono): they must use the same mono uppercase label voice, not a
// sans-uppercase "eyebrow". mb.css only loads under the #MB-Web app.
test("MB-Web column labels use the mono uppercase voice", async ({ page }) => {
  await page.goto("/#MB-Web");
  // mb.css applies to a bare `.mb-lab`; build one so the rule is asserted without
  // needing a paper open in bilingual mode.
  const lab = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "mb-lab";
    el.textContent = "EN · 原文";
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const r = { ff: cs.fontFamily, ls: cs.letterSpacing, fs: cs.fontSize };
    el.remove();
    return r;
  });
  expect(lab.ff).toContain("IBM Plex Mono");
  // 0.04em on the 11px label = 0.44px (the system label tracking), not 0.06em.
  expect(parseFloat(lab.ls)).toBeCloseTo(0.44, 1);
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
