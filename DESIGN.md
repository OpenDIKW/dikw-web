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
typography:
  display:
    fontFamily: "Source Serif 4, ui-serif, Georgia, Source Han Serif CN, serif"
    fontSize: "clamp(1.5rem, 2.2vw, 1.9rem)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Tight, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter Tight, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.deep-petrol}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.petrol-ink}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 10px"
  status-pill:
    backgroundColor: "{colors.petrol-wash}"
    textColor: "{colors.deep-petrol}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  segmented-control:
    backgroundColor: "{colors.stone-soft}"
    textColor: "{colors.slate}"
    rounded: "{rounded.md}"
    padding: "3px"
---

# Design System: dikw-web

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
tonal line, not from drop shadows. The serif display face on page titles and
article headings is the one deliberate moment of editorial warmth in an
otherwise technical, monospace-aware system.

This system explicitly rejects the generic SaaS dashboard (multi-color status
walls, hero-metric blocks, heavy card grids), the AI-template look (cream-and-
terracotta, tracked uppercase eyebrows on every section, 01/02/03 scaffolding),
and decorative motion (glass, glow, gradient text, entrance choreography).
Nothing here should read as "AI made that."

**Key Characteristics:**

- Warm-stone neutral canvas; never true white as the page background.
- One accent (deep petrol) used on ≤10% of any screen.
- Hairline borders and tonal layering instead of shadows.
- Serif for titles/reading, sans for UI, mono for IDs/paths/labels.
- Full light + dark parity; the reader keeps a low-glare dark surface.

## 2. Colors

A warm-stone neutral field carrying a single cool deep-petrol accent. The
neutrals are warm (no green tint); the accent stands alone so it never reads
as decoration.

### Primary

- **Deep Petrol** (`#0d5e57`): The one accent. Primary buttons, active nav
  markers, links, focus, selected segmented-control text. Dark mode shifts it
  brighter (`#4eb8a6`) to hold contrast on warm-dark surfaces.
- **Petrol Ink** (`#094540`): The pressed/hover deepening of the accent and
  the reader link color. Borders the primary button.
- **Petrol Wash** (`#e2eeec`): The only accent tint — soft background for
  petrol status pills and accent-soft surfaces. Used sparingly.

### Neutral

- **Warm Stone** (`#f5f3ee`): Page background. Never `#ffffff` — true white is
  reserved for raised surfaces so the layering reads.
- **Paper White** (`#ffffff`): Raised surfaces — cards, panels, sidebar,
  inputs, the reader article pane.
- **Stone Soft / Stone Sink** (`#faf9f5` / `#f0eee8`): Recessed and secondary
  fills — segmented-control track, table heads, muted pills.
- **Hairline / Line / Line Strong** (`#ebe8df` / `#e2dfd6` / `#cdc9bd`): The
  three-step border ramp. Hairline for internal dividers, line for surface
  edges, line-strong for interactive control strokes (inputs, secondary
  buttons).
- **Graphite / Slate / Ash** (`#1a1d1c` / `#6c6f6a` / `#95968f`): Text ramp —
  body ink, muted metadata, subtle placeholder. All three hold ≥4.5:1 (body)
  or ≥3:1 (large/meta) against their surfaces.

### Secondary

Status signals are muted, desaturated, and used **only** for state — never as
decoration. **Signal Green** (`#2f7a4d`), **Signal Amber** (`#8a5a14`),
**Signal Red** (`#a8362c`), **Signal Blue** (`#2f6aa8`). They render as
`status-pill`s with a 16–18% tinted background and a matching 25%-alpha border.

### Named Rules

**The One Indicator Rule.** Deep petrol is the only chromatic accent and
appears on ≤10% of any screen. Its rarity is the signal. Never introduce a
second brand accent; warmth is carried by the neutrals and the serif, not by
a second hue.

**The No-True-White-Background Rule.** The page background is always warm
stone (`#f5f3ee`), never `#ffffff`. White is a raised-surface color. If a full
screen reads as flat white, the layering has collapsed.

## 3. Typography

**Display Font:** Source Serif 4 (with Georgia, Source Han Serif CN fallbacks)
**Body / UI Font:** Inter Tight (with Inter, system-ui fallbacks)
**Label / Mono Font:** JetBrains Mono (with SFMono, Sarasa Mono SC fallbacks)

**Character:** A three-voice system pairing on a true contrast axis — an
editorial serif for titles and long-form reading, a tight humanist sans for
the interface, and a monospace for the machine layer (IDs, paths, frontmatter
keys, uppercase labels). The serif is the only warmth; the mono is the only
place uppercase + letter-spacing is allowed.

### Hierarchy

- **Display** (Source Serif 4, 500, `clamp(1.5rem, 2.2vw, 1.9rem)`, 1.2): Page
  titles and reader article H1/H2. The one editorial moment. Letter-spacing
  `-0.01em`; never tighter than `-0.04em`.
- **Title** (Inter Tight, 600, ~17px, 1.3): Panel headings, card titles,
  session names — the UI's structural labels.
- **Body** (Inter Tight, 400, ~15px, 1.55): Interface text, descriptions,
  agent replies. Reader prose caps line length at 65–75ch.
- **Label** (JetBrains Mono, 500, ~11px, `0.04em`, UPPERCASE): Field labels,
  table heads, status posture, code labels. The **only** uppercase in the
  system.

### Named Rules

**The Mono-Only-Uppercase Rule.** Uppercase text with letter-spacing is
permitted exclusively in the JetBrains Mono label role (field labels, table
heads, IDs). Never set sans or serif in tracked uppercase — that is the AI
"eyebrow" tell, and it is forbidden here.

## 4. Elevation

This is a near-flat, hairline-first system. Depth is conveyed by a tonal
border ramp (hairline → line → line-strong) and by warm-stone-vs-white
surface contrast, **not** by drop shadows. The single shadow token is a 1px
tonal line that simulates a crisp edge, not a float.

### Shadow Vocabulary

- **Edge Line** (`box-shadow: 0 1px 0 rgba(20,29,28,0.04)` light /
  `0 1px 0 rgba(0,0,0,0.4)` dark): The only elevation. Applied to cards,
  panels, and the composer to crisp their bottom edge. Reads as a precise
  hairline, never as a lifted card.

### Named Rules

**The Hairline-Not-Box Rule.** Separation comes from 1px borders and surface
tone, never from blur. A 24px soft drop shadow is forbidden — it was removed
once already because it was invisible on warm stone and read as generic SaaS.
If you reach for `box-shadow` with a blur radius > 1px, use a border instead.

## 5. Components

### Buttons

- **Shape:** Gently rounded, 6px radius (`{rounded.sm}`), 36px min-height,
  weight 500, 120ms color transitions.
- **Primary:** Deep-petrol fill, white text, 1px petrol-ink border, `0 14px`
  padding. Hover deepens to petrol-ink. The only filled-accent surface.
- **Secondary / Icon:** White surface, 1px line-strong border, graphite text.
  Hover lifts the border and shifts to stone-soft. Icon buttons are a 38px
  square of the same treatment. A `--danger` modifier recolors text only.

### Inputs / Fields

- **Style:** White surface, 1px line-strong border, 6px radius, 36px height
  (textarea min 82px, vertical resize only).
- **Label:** Mono, 11px, uppercase, slate — sits above the control in a 6px
  grid gap.
- **Focus:** Border shifts to deep petrol plus a 3px petrol-tinted ring. The
  ring color must derive from the accent token, not a hardcoded near-petrol.

### Chips / Status Pills

- **Style:** Fully rounded pill (999px), 12px text, weight 500, `4px 8px`
  padding, 1px transparent-to-tinted border.
- **State:** One variant per signal (ok/info/warn/bad/muted) using a 16–18%
  tint of the signal color on background and a 25%-alpha matching border.
  Pills carry state, never decoration.

### Segmented Control

- **Style:** Stone-soft track, 8px radius, 3px inset padding, 2px gap. Buttons
  are 28px, mono-adjacent 12px/600 slate text, transparent border.
- **State:** Active/hover button gets a white surface, petrol-tinted border,
  and petrol-ink text. The chosen pattern for mutually exclusive view choices.

### Cards / Panels

- **Corner Style:** 8px radius (`{rounded.md}`).
- **Background:** Paper white on the warm-stone page.
- **Border:** 1px line. **Shadow:** the Edge Line token only (see Elevation).
- **Internal Padding:** 16–20px. Never nest a card inside a card.

### Navigation (sidebar)

- **Style:** White sidebar on warm stone, grouped routes, 232px fixed width,
  sticky full-height. Settings pinned to the footer, never a primary route.
- **States:** Active route uses a 2px leading petrol marker plus weight, not a
  filled pill. Hover is a quiet stone-soft fill. Single-language per locale —
  never bilingual chrome like `Overview / 工作台概览`.

## 6. Do's and Don'ts

### Do:

- **Do** keep the page background warm stone (`#f5f3ee`); reserve `#ffffff`
  for raised surfaces.
- **Do** spend the deep-petrol accent rarely (≤10% of a screen) and only where
  it means something — primary action, active state, link, focus.
- **Do** separate surfaces with 1px hairline borders and surface tone; depth
  is structural, not floated.
- **Do** keep control + card radii on the `4 / 6 / 8 / 999` scale; controls at
  6–7px, cards at 8px, pills fully round. Larger radii (10–14px) are reserved
  for two intentional cases only: chat bubbles (incl. the asymmetric user
  bubble) and large decorative icon tiles. Don't invent new one-off radii for
  standard controls.
- **Do** confine uppercase + letter-spacing to the JetBrains Mono label role.
- **Do** maintain WCAG AA: body ≥4.5:1, large ≥3:1, meta/controls ≥3:1, in
  both light and dark, and give every animation a `prefers-reduced-motion`
  fallback.

### Don't:

- **Don't** build generic SaaS dashboards — no multi-color status walls, no
  hero-metric blocks (big number + small label + gradient), no heavy
  drop-shadow card grids.
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
