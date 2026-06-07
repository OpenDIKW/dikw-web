# dikw-web UI Verification Checklist

A pass/fail rubric for the qualitative UI rules that automated gates can't fully
assert. The `dikw-web-verify-frontend` skill runs this against every changed
route in **both light and dark mode** before reporting a UI change done. Each
item gives a concrete criterion and how to check it. Source of truth for the
underlying rules: `docs/ui-system.md`, `CLAUDE.md` (UI rules), `docs/graph-view.md`.

Many of these are already locked by an e2e spec (noted as "e2e: …"); for those,
the browser pass is a sanity check, and the spec is the durable gate. Items with
no e2e are the ones the manual pass exists for.

## How to use

1. For each changed `#route`, open it in the running dev server (`http://127.0.0.1:4321`).
2. Walk the items below that apply to the change. A change to tokens/`styles.css`
   or any shared chrome touches **every** route — verify a representative few.
3. Light + dark each. Note any ❌ and fix before reporting done.

## Global chrome

- [ ] **Single-language chrome.** No UI element shows both `en` and `zh-CN`
  (e.g. `Overview / 工作台概览`). Nav, headers, tabs, buttons, empty states,
  tooltips, notices render in the current locale only. Switch locale in
  Settings and re-check. Core data (markdown bodies, task JSON, provider/model
  names, paths) is **not** translated. _e2e: `i18n.spec.ts`._
- [ ] **Breadcrumb root is fixed.** Top-bar crumb root is `Workbench` / `工作台`,
  not the brand name, regardless of `config.json` branding.
- [ ] **Token never displayed.** Settings token input is a password field; the
  top-bar connection chip shows only `Token configured` / `No token` — never the
  token value or any substring of it. _e2e: `navigation.spec.ts` (masked input)._
- [ ] **No horizontal overflow** at desktop (1440) and mobile (390) widths.
  _e2e: `navigation.spec.ts`._

## Visual language (tokens, not vibes)

- [ ] **No UI framework.** No Tailwind (`@tailwind`, `className` utility soup),
  Radix, shadcn, or other component-library imports. New styling consumes
  `src/styles.css` CSS variables and the shared component classes (`panel`,
  `segmented-control`, `status-pill`, `field`, `*-button`). Quick check:
  `git diff` introduces no new UI dep in `package.json`; grep the diff for
  `@tailwind` / `@radix-ui` / `shadcn`.
- [ ] **Small radii.** Cards and controls keep `border-radius ≤ 8px`. No
  oversized/pill radii on work surfaces.
- [ ] **Restrained shadows.** Shadows separate work areas, not decorate. No
  heavy drop shadows, no decorative gradients, no one-off page colors.
- [ ] **Warm-neutral + petrol.** Light mode keeps the warm-stone neutral palette
  with the petrol accent and hairline borders; no admin-dashboard look.

## Dark mode (reader)

- [ ] **Low-glare reader.** On `#base` / `#wisdom` center reader pane in dark
  mode, no large near-white (`#f0…`+) article/control block ≥ ~200px wide.
  Code blocks, quotes, tables, tabs, metadata all use reader tokens.
- [ ] **Contrast.** Normal article text ≥ 4.5:1; large headings ≥ 3:1;
  metadata/control text ≥ 3:1 against their background. _e2e: `theme.spec.ts`
  computes these — re-run it for reader changes rather than eyeballing._
- [ ] **No console errors** in either theme (the e2e console gate covers mocked
  flows; the manual pass covers real-data rendering). See `tests/e2e/harness.ts`.

## Graph (`#graph`)

> Do **not** verify the Pixi canvas through Chrome MCP — a background MCP tab
> halts `requestAnimationFrame`, so the canvas never builds. Use
> `npx playwright test graph.spec.ts --headed` instead.

- [ ] **Only two filters.** Search + Hide-orphans, nothing else. No
  layer-scope toggle (`knowledge`/`source`/`all`), no force/spring/coulomb
  sliders. Request to `/v1/base/graph` carries only `active=true`.
- [ ] **Always-visible legend** for Wiki (petrol) and Source (muted) node colors.
- [ ] **No bloom/halo.** Focus and path emphasis come from stroke weight,
  opacity, and color; cluster nebulae are low-alpha context. _e2e: `graph.spec.ts`._
- [ ] **Accessible node overlay.** Pixi nodes have stable DOM `button` targets
  for keyboard/test access.
- [ ] **No body reads for edges.** Graph never fetches `/v1/base/pages/{path}` to
  build edges. _e2e: `graph.spec.ts`._

## Reader content safety (`MarkdownView`)

- [ ] **HTML allow-list holds.** Only `table/thead/tbody/tfoot/tr/th/td/caption/
  colgroup/col/br` and `details/summary` survive as live DOM. Scripts, styles,
  event attributes (`onclick`, `onerror`), and other raw HTML must **not**
  render. _e2e: `wiki.spec.ts`, `markdown-assets.spec.ts`._
- [ ] **Math / Mermaid / charts** render with text/code/table fallbacks on
  failure (data never lost). KaTeX for `$…$`/`$$…$$`; Mermaid `securityLevel:
  "strict"`; charts via ECharts → fall back to the source pipe table.
- [ ] **Images** resolve via `assets[]` (both `![alt](path)` and `![[path]]`);
  unresolved local refs show `.md-broken-image`, empty `![]()` collapses.

## Surface-specific contracts

- [ ] **Base = source + knowledge only**; wisdom lives on `#wisdom`. _e2e: filtering._
- [ ] **Chat right rail is session-scoped** accumulated sources/tool calls — it
  does **not** filter when an assistant reply is clicked. Message/Sources/Tools
  lists each bottom-stick independently; a new message resets all three.
  _e2e: `chat.spec.ts`._
- [ ] **Tasks op gate** (Ingest/Synth/Lint Propose/Lint Apply) disables while any
  task is running/pending, independent of the Status/Op filter.
