---
name: dikw-web
description: A quiet, precise knowledge workbench — warm-stone neutrals, a single deep-petrol accent, hairline structure.
colors:
  warm-stone: "#f5f3ee"
  paper-white: "#ffffff"
  stone-soft: "#faf9f5"
  stone-sink: "#f0eee8"
  hairline: "#ebe8df"
  line: "#e2dfd6"
  line-strong: "#cdc9bd"
  graphite: "#1a1d1c"
  slate: "#6c6f6a"
  ash: "#95968f"
  deep-petrol: "#0d5e57"
  petrol-ink: "#094540"
  petrol-wash: "#e2eeec"
  signal-green: "#2f7a4d"
  signal-amber: "#8a5a14"
  signal-red: "#a8362c"
  signal-blue: "#2f6aa8"
  # Aliases & alpha layers (track the theme via --red / --text / --accent).
  danger: "{colors.signal-red}"
  line-alpha: "color-mix(in srgb, {colors.graphite} 12%, transparent)"
  line-alpha-strong: "color-mix(in srgb, {colors.graphite} 22%, transparent)"
  overlay-hover: "color-mix(in srgb, {colors.graphite} 5%, transparent)"
  overlay-active: "color-mix(in srgb, {colors.graphite} 9%, transparent)"
  accent-border-hover: "color-mix(in srgb, {colors.deep-petrol} 35%, {colors.line})"
typography:
  # Six roles across three voices. Each maps to --type-<role>-{size,lh,ls} in styles.css.
  display: # IBM Plex Serif — reader article H1/H2 (the one editorial voice)
    fontFamily: "IBM Plex Serif, ui-serif, Georgia, Songti SC, Source Han Serif CN, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.01em"
  title-page: # IBM Plex Sans — page-header H1 (NOTE: sans, not serif)
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title: # IBM Plex Sans — panel / card / session headings
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body: # IBM Plex Sans — interface text, descriptions, agent replies
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  body-sm: # IBM Plex Sans — dense metadata / secondary UI text
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label: # IBM Plex Mono UPPERCASE — field labels, table heads, IDs
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Consolas, Sarasa Mono SC, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  xs: "4px" # chips, skeletons
  sm: "6px" # segmented-control buttons, inline code
  control: "7px" # buttons, inputs, selects (the default control radius)
  md: "8px" # cards, panels, segmented track
  pill: "999px" # status pills, avatars, dots
spacing:
  # 4px base. Half-steps (-1h/-2h/-3h) record entrenched 6/10/14px usage.
  "0": "0"
  "1": "4px"
  "1h": "6px"
  "2": "8px" # inside a group
  "2h": "10px"
  "3": "12px"
  "3h": "14px"
  "4": "16px" # between groups
  "5": "20px"
  "6": "24px"
  "8": "32px" # between sections (min)
  "10": "40px" # between sections (max)
  "12": "48px"
motion:
  dur-fast: "120ms" # control color/border state (the de-facto default)
  dur-state: "140ms" # compound state changes, small transforms
  dur-popover: "180ms" # menus, popovers, tooltips
  dur-overlay: "240ms" # drawers, dialogs, dual-column reveal
  ease-standard: "cubic-bezier(0.2, 0, 0, 1)" # default UI easing
  ease-emphasis: "cubic-bezier(0.175, 0.885, 0.32, 1.1)" # slight overshoot, sparing
components:
  button-primary:
    backgroundColor: "{colors.deep-petrol}"
    textColor: "{colors.paper-white}"
    border: "1px solid {colors.petrol-ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    minHeight: "36px"
  button-primary-hover:
    backgroundColor: "{colors.petrol-ink}"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.graphite}"
    border: "1px solid {colors.line-strong}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    minHeight: "36px"
  button-secondary-hover:
    borderColor: "{colors.accent-border-hover}"
    backgroundColor: "{colors.stone-soft}"
  button-danger: # modifier on secondary — recolors text only
    textColor: "{colors.danger}"
  button-icon:
    width: "38px"
    rounded: "{rounded.control}"
    border: "1px solid {colors.line-strong}"
    backgroundColor: "{colors.paper-white}"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.graphite}"
    border: "1px solid {colors.line-strong}"
    rounded: "{rounded.control}"
    minHeight: "36px"
    padding: "0 10px"
    focusBorder: "{colors.deep-petrol}"
    focusRing: "0 0 0 3px color-mix(in srgb, {colors.deep-petrol} 24%, transparent)"
  status-pill:
    backgroundColor: "color-mix(in srgb, <signal> 16%, transparent)"
    textColor: "<signal>"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  segmented-control:
    trackBackground: "{colors.stone-soft}"
    trackBorder: "1px solid {colors.line}"
    trackRounded: "{rounded.md}"
    trackPadding: "3px"
    buttonRounded: "{rounded.sm}"
    activeBackground: "{colors.paper-white}"
    activeBorder: "{colors.accent-border-hover}"
    activeText: "{colors.petrol-ink}"
  card:
    backgroundColor: "{colors.paper-white}"
    border: "1px solid {colors.line}"
    rounded: "{rounded.md}"
    shadow: "0 1px 0 rgba(20,29,28,0.04)"
    padding: "16px"
---

# Design System: dikw-web

> Tokens are the contract. This document defines the **role** each token plays —
> which surface, which border, which text rank, which hover/active state — so
> that styling is read off a table, never hand-picked per element. When a token
> already exists for a job, use it; a new literal hex or off-grid pixel value is
> almost always a mistake. The companion implementation lives in
> `src/styles.css` (tokens) and `docs/ui-system.md` (rendering contracts); the
> per-route pass/fail rubric is `docs/ui-checklist.md`.

## 1. Overview

**Creative North Star: "The Quiet Instrument"**

dikw-web is a precision instrument for reading and reasoning over a personal
knowledge base. Like a well-made reference tool, it earns trust by receding:
the chrome is calm warm-stone and hairline structure, and the knowledge —
documents, graphs, agent replies — is the only thing allowed to carry color
and weight. A single deep-petrol accent is the instrument's one indicator
light; it appears rarely and means something every time.

Density is a feature, not a flaw. This is a tool for sustained, repeated,
expert use, so it packs information tightly — but the density is earned
through rhythm, alignment, and restraint, never through clutter. Whitespace
is structural. Borders are hairlines, not boxes. Depth comes from a 1px
tonal line, not from drop shadows. The serif display face on reader article
headings is the one deliberate moment of editorial warmth in an otherwise
technical, monospace-aware system.

This system explicitly rejects the generic SaaS dashboard (multi-color status
walls, hero-metric blocks, heavy card grids), the AI-template look (cream-and-
terracotta, tracked uppercase eyebrows on every section, 01/02/03 scaffolding),
and decorative motion (glass, glow, gradient text, entrance choreography).
Nothing here should read as "AI made that."

**Key Characteristics:**

- Warm-stone neutral canvas; never true white as the page background.
- One accent (deep petrol) used on ≤10% of any screen.
- Hairline borders and tonal layering instead of shadows.
- Serif for reading, sans for UI and page titles, mono for IDs/paths/labels.
- Full light + dark parity; the reader keeps a low-glare dark surface.
- A 4px spacing grid, a tight radius scale, and a four-step motion scale —
  documented below so density never becomes noise.

## 2. Colors

A warm-stone neutral field carrying a single cool deep-petrol accent. The
neutrals are warm (no green tint); the accent stands alone so it never reads
as decoration.

### Primary

- **Deep Petrol** (`#0d5e57`, `--accent`): The one accent. Primary buttons,
  active nav markers, links, focus, selected segmented-control text. Dark mode
  shifts it brighter (`#4eb8a6`) to hold contrast on warm-dark surfaces.
- **Petrol Ink** (`#094540`, `--accent-strong`): The pressed/hover deepening of
  the accent and the reader link color. Borders the primary button.
- **Petrol Wash** (`#e2eeec`, `--accent-soft`): The only accent tint — soft
  background for petrol status pills and accent-soft surfaces. Used sparingly.

### Neutral

- **Warm Stone** (`#f5f3ee`, `--bg`): Page background. Never `#ffffff` — true
  white is reserved for raised surfaces so the layering reads.
- **Paper White** (`#ffffff`, `--surface`): Raised surfaces — cards, panels,
  sidebar, inputs, the reader article pane.
- **Stone Soft / Stone Sink** (`#faf9f5` / `#f0eee8`, `--surface-soft` /
  `--surface-2`): Recessed and secondary fills — segmented-control track, table
  heads, muted pills, hover backgrounds.
- **Hairline / Line / Line Strong** (`#ebe8df` / `#e2dfd6` / `#cdc9bd`,
  `--hairline` / `--line` / `--line-strong`): The three-step border ramp.
  Hairline for internal dividers, line for surface edges, line-strong for
  interactive control strokes (inputs, secondary buttons).
- **Graphite / Slate / Ash** (`#1a1d1c` / `#6c6f6a` / `#95968f`, `--text` /
  `--muted` / `--subtle`): Text ramp — body ink, muted metadata, subtle
  placeholder. **Graphite and slate** carry the AA guarantee (graphite ≥4.5:1
  for body, slate ≥3:1 for large/meta) on both surfaces; **ash is for
  non-essential placeholder / disabled hints only** (~3:1, under the WCAG
  placeholder exemption) — never use it for body or metadata a reader must
  parse. **Rank information with this ramp first** — reach for weight and size
  before reaching for color.

### Secondary

Status signals are muted, desaturated, and used **only** for state — never as
decoration. **Signal Green** (`#2f7a4d`, `--green`), **Signal Amber**
(`#8a5a14`, `--amber`), **Signal Red** (`#a8362c`, `--red`), **Signal Blue**
(`#2f6aa8`, `--blue`). They render as `status-pill`s with a 16–18% tinted
background. `--danger` is an **alias of `--red`** for destructive control text;
it is defined once and tracks the theme through `--red`.

### Alpha layers

Solid `--line` is for opaque surface edges. When a border, divider, or hover
fill must layer over a **tinted or arbitrary** background and still track the
theme, use the alpha tokens (built with `color-mix`, so no dark override is
needed): `--line-alpha` / `--line-alpha-strong` (translucent edges),
`--overlay-hover` / `--overlay-active` (hover/pressed fills),
`--accent-border-hover` (the petrol-tinted interactive stroke). These exist to
**retire scattered literals** like `#cbd8d4` / `#c5dad5` / `#9fb0aa`.

### Intent Mapping (read hover/active states off this table)

This is the only place state styling is decided. Each row is a job; the columns
give the existing token for the neutral and accent context. **Never invent a
new literal for a hover or active state — look it up here.**

| Job              | Neutral (warm-stone)      | Accent (petrol)          |
| ---------------- | ------------------------- | ------------------------ |
| Background       | `--bg`                    | `--accent-soft`          |
| Hover background | `--surface-soft`          | `--overlay-hover`        |
| Active / pressed | `--surface-2`             | `--overlay-active`       |
| Border (resting) | `--line`                  | `--accent-border-hover`  |
| Border (hover)   | `--line-strong`           | `--accent`               |
| Border (active)  | `--line-strong`           | `--accent-strong`        |
| Solid fill       | `--surface` (raised)      | `--accent`               |
| Fill (hover)     | `--surface-soft`          | `--accent-strong`        |
| Secondary text   | `--muted` / `--subtle`    | `--accent`               |
| Primary text     | `--text`                  | `--accent-strong`        |

### Named Rules

**The One Indicator Rule.** Deep petrol is the only chromatic accent and
appears on ≤10% of any screen. Its rarity is the signal. Never introduce a
second brand accent; warmth is carried by the neutrals and the serif, not by
a second hue.

**The No-True-White-Background Rule.** The page background is always warm
stone (`#f5f3ee`), never `#ffffff`. White is a raised-surface color. If a full
screen reads as flat white, the layering has collapsed.

## 3. Typography

**Reading / Serif:** IBM Plex Serif (with Georgia, Source Han Serif CN fallbacks)
**Body / UI Sans:** IBM Plex Sans (with system-ui, -apple-system fallbacks)
**Label / Mono:** IBM Plex Mono (with SFMono, Sarasa Mono SC fallbacks)

**Character:** One superfamily, three voices. IBM Plex Sans / Serif / Mono share
a single family's DNA, so the contrast that separates the voices is **role**, not
foundry — an editorial serif for long-form reading, a humanist sans for the
interface (including page titles), and a monospace for the machine layer (IDs,
paths, frontmatter keys, uppercase labels). Coordination is the point: the three
read as siblings, not three downloads. CJK glyphs fall through to the system fonts
(PingFang / Songti / YaHei) since Plex covers Latin only. Fonts load from Google
Fonts (external — outside the bundle budget). The serif is the only warmth; the
mono is the only place uppercase + letter-spacing is allowed.

### Type Roles

Six roles collapse the 30-plus ad-hoc sizes once scattered through the
stylesheet. Each role is one row, exposed in `styles.css` as
`--type-<role>-size` / `--type-<role>-lh` / `--type-<role>-ls`. Reach for a
role, not a raw pixel size.

The **small-text band (11–17) is closed**: every secondary UI element lands on
`body-sm` (13) or `label` (11) — there is no 12px tier crammed between them, and
no stray 14 / 16 sitting beside `body` (15) / `title` (17). `body-sm` is the home
for *all* dense machine metadata — IDs, paths, durations, pills, table cells,
hints, segmented controls — that previously drifted to an undocumented 12px. The
`no UI text renders off the role scale` e2e invariant guards this band across the
workbench routes (a passive, default-viewport sweep). The editorial / responsive
heading sizes that lived outside the small-text band are now on the ladder too:
`.wiki-preview-card h2` (19 → title 17), `.import-done-banner__headline` (20 →
title 17), `.wisdom-popover__title h2` (15.5 → body 15), and the responsive
`.metric-card__value` downscales (24 / 26 → 22, the reader-h2 editorial step). The
only deliberate off-role size left is em-relative notation (inline code, KaTeX) and
the MB-Web paper title (see the subsystem note below).

The **cascade base** is the body role: `body` sets `font-size:
var(--type-body-size)` (15px), so any unsized text — and every `font: inherit`
control (buttons, inputs, selects) — rides the scale instead of the browser's
16px default.

| Role           | Voice          | Size | Line-height | Tracking | Weight  | Used for                                                |
| -------------- | -------------- | ---- | ----------- | -------- | ------- | ------------------------------------------------------- |
| **display**    | IBM Plex Serif | 32px | 1.18        | -0.01em  | 600     | Reader article H1 / fallback title — the editorial voice |
| **title-page** | IBM Plex Sans  | 30px | 1.1         | -0.01em  | 600     | Page-header H1 — **sans, not serif** (see note below)   |
| **title**      | IBM Plex Sans  | 17px | 1.3         | -0.005em | 600     | Panel / card / session / detail headings                |
| **body**       | IBM Plex Sans  | 15px | 1.55        | 0        | 400     | Interface text, descriptions, agent replies             |
| **body-sm**    | IBM Plex Sans  | 13px | 1.45        | 0        | 400/500 | Dense metadata, secondary UI text                       |
| **label**      | IBM Plex Mono  | 11px | 1.2         | 0.04em   | 500     | Field labels, table heads, IDs — the **only** uppercase |

**Where the serif appears (and where it does not).** The editorial serif is used
in exactly three places: (1) the **document reader** prose — `.markdown-body
h1/h2/h3`, the fallback title, and the reader-header title; (2) the **assistant
reply** prose — the agent markdown headings; and (3) the two **stat-number** tiers
(the 27px hero metric value, the 18px summary stat). Everything else is sans:
workbench **page titles** (`.page-header h1`, the `title-page` role) and **every
panel / card / detail heading** (the `title` role, 17px) — including the task,
wisdom, and graph detail H2s, which previously sprawled serif across ~8 ad-hoc
sizes. Keeping the serif to reading + numbers is what makes the reading moment
special and the chrome read as one sans family. Reader prose caps line length at
65–75ch.

**Editorial serif sub-scale.** The serif voice spans five deliberate steps that
sit alongside (not inside) the six text roles, since titling and numerals are not
body text: reader-display **32**, reader-h2 **22**, reader-h3 **17**, hero-number
**27**, stat-number **18** — all weight 600.

**Table heads vs. user tables.** The label role's "table heads" are the
workbench's own data-table column labels (`.result-table__head`,
`.metrics-table__head`) — chrome, so mono uppercase. The Markdown reader's table
headers (`.markdown-table-wrap th`) are **user-authored content** and render
verbatim — sans `body-sm`, never force-uppercased — so a header like `pH` or
`mRNA` is not mangled; the header row stays distinct by weight + surface, not
case. (Mono labels are weight **500** throughout: the family ships only 400/500,
so a `font-weight: 600` on a mono label is a silent no-op — don't reintroduce it.)

**Off-ladder exemptions.** Two contexts are em-relative *notation*, not UI text,
and intentionally sit off the role ladder (the scale + floor guards skip them):
inline / block **code** is `0.92em` of its surrounding prose (so it scales with
context), and **KaTeX** math sub/superscripts and layout struts size themselves
relative to the formula. Everything else is on-ladder.

**Subsystem boundary — MB-Web.** The focused 论文 reader (`src/mb/mb.css`,
`.mb-`-prefixed) now consumes the `--type-*` role tokens for **type**: its former
half-step scale (11.5 / 12.5 / 13.5 / 14.5 …) collapsed onto label / body-sm / body
/ title by nearest role, and the global `styles.css` (imported app-wide in
`main.tsx`) makes the tokens available inside the MB-Web tree. The one deliberate
literal is `.mb-r-title` (22px) — the paper-reader title, the reader-h2 editorial
step, kept compact rather than the workbench reader's 32. MB-Web's **radii and
colors now ride the shared tokens too**: every differently-named local token
(`--ac` / `--acb` / `--border` / …) aliases its `styles.css` equivalent and the
same-named ones (`--bg` / `--surface` / `--text` / …) inherit the global light +
dark values, so the parallel dark block is gone; its former off-scale radii
snapped to the `4 / 6 / 7 / 8 / 999` scale (cards 8px, the badge / chip / filter /
toast / sync pills fully round). The few genuinely MB-specific literals with no
shared equivalent stay named and local: the answer-blue pair (`--ans-*`), the
on-accent foreground (`--acfg`), the AA-darkened `--faint`, the hover wash
(`--hover-bp`), and the note highlighter (`--mb-mark` / `--mb-mark-staged`).

**The agent surface rides the roles.** Assistant and user messages use the body
role (15px) for prose, the editorial serif for the three markdown heading levels
(17 / 15 / 13, weight 600), body-sm mono for code, and the 11px mono label for the
role chip — no private chat sub-scale.

### Named Rules

**The Mono-Only-Uppercase Rule.** Uppercase text with letter-spacing is
permitted exclusively in the IBM Plex Mono `label` role (field labels, table
heads, IDs). Never set sans or serif in tracked uppercase — that is the AI
"eyebrow" tell, and it is forbidden here. Every mono label shares **one tracking,
`0.04em`** (`--type-label-ls`) — not the 0.02 / 0.03 / 0.08 / 0.1 spread it grew
into — and the **floor is 11px**: nothing renders smaller (low-vision legibility).

**The Two-Weight Rule.** Keep at most two font weights in a single view; let size
and the gray ramp carry the rest of the hierarchy. Note: markdown `strong`/`b` is
pinned to weight 600, because the UA default `font-weight: bolder` is *relative*
and compounds to 900 inside an already-bold context (a fifth weight, and past IBM
Plex's Bold ceiling).

## 4. Spacing & Rhythm

Spacing rides a **4px base grid**. The scale is exposed as `--space-*`; the
half-steps (`--space-1h` = 6px, `--space-2h` = 10px, `--space-3h` = 14px)
exist only to record the entrenched 6/10/14px values already in the
stylesheet — they are documentation, not new rhythm.

| Token        | Value | Token        | Value |
| ------------ | ----- | ------------ | ----- |
| `--space-0`  | 0     | `--space-4`  | 16px  |
| `--space-1`  | 4px   | `--space-5`  | 20px  |
| `--space-1h` | 6px   | `--space-6`  | 24px  |
| `--space-2`  | 8px   | `--space-8`  | 32px  |
| `--space-2h` | 10px  | `--space-10` | 40px  |
| `--space-3`  | 12px  | `--space-12` | 48px  |
| `--space-3h` | 14px  |              |       |

**The Three-Step Rhythm.** Space groups on a single rhythm: **8px inside a
group** (`--space-2`), **16px between groups** (`--space-4`), **32–40px between
major sections** (`--space-8` / `--space-10`). Card interior padding is 16px
(`--space-4`); the hero/reader pane may take 24px (`--space-6`). For any **new**
layout decision, snap to a whole step — never reach past `--space-2h` for a
fresh value.

## 5. Elevation

This is a near-flat, hairline-first system. Depth is conveyed by a tonal
border ramp (hairline → line → line-strong) and by warm-stone-vs-white
surface contrast, **not** by drop shadows. The single shadow token (`--shadow`)
is a 1px tonal line that simulates a crisp edge, not a float.

### Shadow Vocabulary

- **Edge Line** (`--shadow` = `0 1px 0 rgba(20,29,28,0.04)` light /
  `0 1px 0 rgba(0,0,0,0.4)` dark): The only elevation. Applied to cards,
  panels, and the composer to crisp their bottom edge. Reads as a precise
  hairline, never as a lifted card.

### Named Rules

**The Hairline-Not-Box Rule.** Separation comes from 1px borders and surface
tone, never from blur. A 24px soft drop shadow is forbidden — it was removed
once already because it was invisible on warm stone and read as generic SaaS.
If you reach for `box-shadow` with a blur radius > 1px, use a border instead.
(Floating layers — popovers, the MB selection chip — are the one exception and
already carry their own soft shadow; do not extend that treatment to cards.)

## 6. Motion

Motion clarifies a change; it never decorates. Most interactions should feel
instant — `0ms` is often the right answer, especially for hover fills on dense
lists. Durations and easings are tokens:

| Token            | Value   | Use                                        |
| ---------------- | ------- | ------------------------------------------ |
| `--dur-fast`     | 120ms   | Control color/border state (the default)   |
| `--dur-state`    | 140ms   | Compound state changes, small transforms   |
| `--dur-popover`  | 180ms   | Menus, popovers, tooltips                  |
| `--dur-overlay`  | 240ms   | Drawers, dialogs, dual-column reveal       |
| `--ease-standard`| `cubic-bezier(0.2, 0, 0, 1)`         | Default UI easing             |
| `--ease-emphasis`| `cubic-bezier(0.175, 0.885, 0.32, 1.1)` | Slight overshoot, sparing  |

**The Restraint Rules.** Use `--ease-emphasis` (the overshoot curve) only on a
deliberate enter/select moment — the segmented-control active slide, never a
color fade. Avoid long, looping, or attention-grabbing animation; no entrance
choreography. Drive every transition off a `--dur-*`/`--ease-*` token and give
every animation a `prefers-reduced-motion: reduce` fallback (the existing global
guard already zeroes transitions under that query — keep new motion inside it).

## 7. Shapes / Radii

Radii stay tight and live on one scale; keep a **single radius family per
control group** rather than mixing rounded and sharp.

| Token             | Value | Use                                                |
| ----------------- | ----- | -------------------------------------------------- |
| `xs`              | 4px   | Chips, skeletons                                   |
| `sm`              | 6px   | Segmented-control buttons, inline code             |
| `control`         | 7px   | Buttons, inputs, selects (the default control)     |
| `md` (`--radius`) | 8px   | Cards, panels, segmented track                     |
| `pill`            | 999px | Status pills, avatars, dots                        |

Two intentional exceptions take larger radii (10–14px): **chat bubbles**
(including the asymmetric user bubble) and **large decorative icon tiles**.
Don't invent a new one-off radius for a standard control.

## 8. Components

Specs below are the **real current values** in `src/styles.css`. Where a row is
marked _Tighten_, the spec corrects a documented-vs-shipped drift to resolve in
the incremental token pass (see `docs/ui-refactor-plan.md`).

### Button

| Variant       | Background  | Text        | Border               | Radius    | Padding | Min-height |
| ------------- | ----------- | ----------- | -------------------- | --------- | ------- | ---------- |
| **primary**   | `--accent`  | `#ffffff`   | 1px `--accent-strong`| 7px       | `0 14px`| 36px       |
| **secondary** | `--surface` | `--text`    | 1px `--line-strong`  | 7px       | `0 12px`| 36px       |
| **icon**      | `--surface` | `--text`    | 1px `--line-strong`  | 7px       | 38px sq | 36px       |
| **danger**    | _(secondary)_ | `--danger`| _(secondary)_        | _(secondary)_ | _(secondary)_ | _(secondary)_ |

- Primary hover deepens to `--accent-strong`. Secondary/icon hover lifts the
  border to `--accent-border-hover` and the fill to `--surface-soft`. Weight
  500, transitions on `--dur-fast`.
- **danger** is a modifier that recolors **text only** (`--danger`, now defined
  as `var(--red)`); it does not change the fill.
- _Tighten:_ control radius is **7px** (not the 6px earlier prose claimed). The
  secondary/icon hover-border literal `#9fb0aa` **migrated** to
  `--accent-border-hover` (Phase 2). The shared `Button` / `IconButton` wrappers
  (Phase 1) carry these styles; `danger` is a prop, not a class.

### Field / Input

- White surface (`--surface`), 1px `--line-strong` border, **7px** radius, 36px
  height (input/select). Textarea min-height 82px, `resize: vertical` only,
  10px padding; input/select padding `0 10px`.
- **Label** uses the `label` role (mono 11px uppercase, `--muted`), sitting
  above the control in a 6px (`--space-1h`) grid gap.
- **Focus** shifts the border to `--accent` plus the 3px `--focus-ring`. The
  ring derives from `--accent`, never a hardcoded near-petrol.

### Badge / Status Pill

- Fully rounded pill (999px), 12px / 600 text, `4px 8px` padding.
- One variant per signal — **ok** / **info** / **bad** at a 16% tint of the
  signal color, **warn** at 18%, **muted** on `--surface-2`. Text is the solid
  signal color. Pills carry state, never decoration; pair the color with an
  icon or label (never color alone).
- _Tighten:_ the pills currently ship with **no border**. Earlier prose
  promised a 25%-alpha border; the doc now matches reality (no border). Adding
  matching alpha borders is a deliberate Phase-2 choice, not an assumed default.

### Segmented Control

- Track: `--surface-soft`, 1px `--line`, 8px radius, 3px inset padding, 2px gap.
- Button: 28px min-height, `0 10px` padding, 6px radius, transparent border,
  `--muted` 12px / 600 text.
- Active/hover button: `--surface` fill, `--accent-border-hover` border
  (the `#c5dad5` literal **migrated** in Phase 2), `--accent-strong` text. The
  chosen pattern for mutually exclusive view choices. Optionally animate the
  active state with `--dur-state` + `--ease-emphasis`. The shared
  `SegmentedControl` wrapper (Phase 2) renders this; `WikiReaderTabs` and
  MB-Web's `.mb-seg` stay bespoke.

### Cards / Panels

- Paper white (`--surface`) on the warm-stone page, 1px `--line` border, 8px
  (`--radius`) corners, the Edge Line shadow only.
- Internal padding 16px (`--space-4`); the reader pane may take 24px. **Never
  nest a card inside a card.**
- _Tighten:_ panel/section title color literal `#25322f` **migrated** to
  `--text` (Phase 2; the now-redundant dark override was dropped). _Still
  pending:_ the 13px metric-card padding → `--space-3` (12px) — a 1px layout
  tighten deliberately deferred from the Phase-2 color-literal pass.

### Navigation (sidebar)

- White sidebar on warm stone, grouped routes, 232px fixed width, sticky
  full-height. Settings pinned to the footer, never a primary route.
- **Active** route uses a 2px leading petrol marker (`::before`) plus weight —
  **not** a filled pill. **Hover** is a quiet `--surface-soft` fill. Single
  language per locale — never bilingual chrome like `Overview / 工作台概览`.
- _Tighten (done, Phase 2):_ the duplicate base/override rules were collapsed and
  the literals `#3c4a46` / `#1d2926` / `#cbd8d4` **migrated** to `--muted` /
  `--text` / `--accent-border-hover`. The resting label is now `--muted` (one
  step lighter than the old hand-picked `#3c4a46`); the active marker, fill, and
  text are unchanged.

## 9. Voice & Content

Chrome copy is part of the design. The app is **single-language per locale**
(`en` _or_ `zh-CN`, never both); core/user content (markdown, JSON, model and
provider names, paths) is rendered **verbatim** and never translated by the web
layer. Rules below are tagged **[EN]**, **[ZH]**, or **[both]**.

- **Casing.** **[EN]** Title Case for buttons, nav, tabs, menu items, and
  column heads (`New Session`, `Hide Orphans`); sentence case for body, helper
  text, and tooltips. **[ZH]** No Title Case — natural, concise phrasing
  (`新建会话`, `隐藏孤立节点`); no full-width spacing tricks for emphasis.
- **Actions = verb + noun.** **[both]** Name an action with a verb and a noun,
  never a bare `Confirm` / `OK` / `确定`. **[EN]** `Delete Session`,
  `Apply Lint`, `Run Ingest`. **[ZH]** `删除会话`, `应用整理`, `运行摄取`.
- **Errors = what happened + what to do.** State the cause, then the remedy;
  never a bare code. **[EN]** `Couldn't reach the core server. Check the Server
  URL in Settings.` **[ZH]** `无法连接到核心服务,请在设置中检查服务地址。`
- **Toasts name the thing, drop "successfully", drop the trailing period.**
  **[EN]** `Session renamed`, `Token saved` (not `Successfully saved the
  token.`). **[ZH]** `已重命名会话`, `已保存令牌` — prefer the `已`-prefix
  completion form; no trailing `。` on a short toast.
- **Empty states point to the first action.** **[EN]** `No sessions yet — start
  one to begin.` with a primary button. **[ZH]** `暂无会话,新建一个开始。`
- **Loading = present participle + ellipsis.** **[EN]** `Loading…`,
  `Translating…`, `Ingesting…`. **[ZH]** `加载中…`, `翻译中…`, `摄取中…` — use
  the `…` character and the `中` continuous form.
- **Numerals, quotes, no filler.** Use digits in chrome (`3 sessions`). Curly
  quotes / Chinese quotation marks per house style. **[EN]** drop `please`
  (`Enter a token`, not `Please enter a token`); **[ZH]** omit `请` where the
  action is obvious. Skip marketing superlatives.
- **Single-language guard.** Never `Overview / 工作台概览`. The breadcrumb root
  is the fixed `Workbench` / `工作台`, independent of the brand name.

## 10. Do's and Don'ts

### Do:

- **Do** rank information with the gray ramp (`--text` → `--muted` →
  `--subtle`); use weight and size before reaching for color.
- **Do** read every hover/active state off the **Intent Mapping** table (§2) —
  never invent a new literal like `#cbd8d4`.
- **Do** keep the page background warm stone (`#f5f3ee`); reserve `#ffffff`
  for raised surfaces.
- **Do** spend the deep-petrol accent rarely (≤10% of a screen) and only where
  it means something — primary action, active state, link, focus.
- **Do** separate surfaces with 1px hairline borders and surface tone; depth
  is structural, not floated.
- **Do** snap spacing to the `--space-*` grid and radii to the `4 / 6 / 7 / 8 /
  999` scale; controls at 7px, cards at 8px, pills fully round.
- **Do** confine uppercase + letter-spacing to the IBM Plex Mono `label` role,
  and keep ≤2 font weights per view.
- **Do** put a focus ring on every interactive element (`--focus-ring` for text
  fields, `--focus-outline` elsewhere — already single-sourced), and drive
  every transition off `--dur-*`/`--ease-*` with a `prefers-reduced-motion`
  fallback.
- **Do** maintain WCAG AA: body ≥4.5:1, large ≥3:1, meta/controls ≥3:1, in
  both light and dark.

### Don't:

- **Don't** signal state with color alone — pair the signal with an icon,
  label, or shape (colorblind + WCAG).
- **Don't** hardcode a hex or an off-grid pixel where a token exists; `--danger`,
  the alpha set, and `--space-*` exist precisely to retire those literals.
- **Don't** mix radii within one control family, or build generic SaaS
  dashboards — no multi-color status walls, no hero-metric blocks (big number +
  small label + gradient), no heavy drop-shadow card grids.
- **Don't** reach for the AI-template look — no cream/sand background with
  serif-plus-terracotta, no tracked uppercase eyebrow above every section, no
  01/02/03 numbered scaffolding used as decoration.
- **Don't** add heavy decoration or motion — no glassmorphism, no glow/bloom,
  no gradient text (`background-clip: text`), no large entrance animations.
- **Don't** crowd or over-color — no neon palette, no second competing accent,
  no oversized radii on standard controls, no icon-everywhere decoration.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe;
  use a full border, a tint, or a leading marker instead.
- **Don't** introduce a 24px soft drop shadow — it's invisible on warm stone
  and reads as a 2014 app; use a hairline.
