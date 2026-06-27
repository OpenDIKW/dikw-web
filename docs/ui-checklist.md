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
- [ ] **Small radii.** Radii stay on the `4 / 6 / 7 / 8 / 999` scale — controls
  7px, cards 8px, pills fully round; only chat bubbles / icon tiles take 10–14px.
  No oversized/pill radii on work surfaces.
- [ ] **Restrained shadows.** Shadows separate work areas, not decorate. No
  heavy drop shadows, no decorative gradients, no one-off page colors.
- [ ] **Warm-neutral + petrol.** Light mode keeps the warm-stone neutral palette
  with the petrol accent and hairline borders; no admin-dashboard look.
- [ ] **Token hygiene.** New hover/active states are read off the Intent Mapping
  table (`DESIGN.md` §2), not new hardcoded hex; new spacing snaps to the
  `--space-*` 4px grid; transitions use `--dur-*`/`--ease-*`. Quick check: `git
  diff` adds no new `#rrggbb` literal or off-grid `px` where a token exists.
- [ ] **Destructive controls recolor.** Danger affordances (the session row
  `...` menu's delete, `.secondary-button--danger`) render their text in red
  (`--red`/`--danger`), not the inherited body color, in both themes.

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

## Bilingual reader (`#base` EN→中)

> On an English Base page with the translator enabled, toggle **AI 翻译** and
> watch the dual column fill. These guard the layout and translation regressions
> found in review.

- [ ] **Dual columns fill the reader pane.** The source / translation columns
  span the full reader width with the centered hairline between them — not capped
  at the single-column 72ch measure that left-hugged the pane and emptied the
  right half (the 0.8.3 layout fix). On an ultra-wide pane the pair caps at two
  reading measures and centers. _e2e: `bilingual.spec.ts` "dual-column view fills
  the reader pane…"._
- [ ] **Figures render once, centered.** A standalone image / figure (`![[…]]`
  or `![](…)` on its own line) appears **once**, centered across both columns —
  never duplicated in the left and right column. (Captions, being prose, are a
  separate block and DO translate.) _Unit: `markdown-blocks.test.ts` classifies
  an image-only block as `special`._
- [ ] **No English left in the translated column.** Every text paragraph in the
  right column is in Chinese — scan for any block that is still verbatim English
  (the model occasionally echoes a long paragraph). The sidecar self-heals these
  (`[translate] block N returned untranslated; re-translated …` in the dev log);
  if one survives, capture the block and the server log. _Unit:
  `server/web/translate.test.ts` "re-translates a block the model echoes back as English"._
- [ ] **No fabricated content in the translated column.** The right column must
  not contain anything absent from the left (source) — watch for an invented
  section, outline, or unrelated paragraph appended after a block (esp. near the
  references / end). The sidecar flags grossly-oversized translations and re-asks
  or falls back to source (`[translate] block N translation … oversized …` in the
  dev log). _Unit: `server/web/translate.test.ts` "re-translates a grossly oversized
  translation"._
- [ ] **Progressive reveal + cache.** Paragraphs fill top-to-bottom as batches
  land (not all at the end). Re-toggling the same unchanged page is instant and
  shows the **已缓存** chip (IndexedDB `dikw-translate-cache`, 7-day TTL). A page
  refresh mid-translation drops to mono view by design (in-memory job, like
  mineru) — a *completed* translation still restores instantly from cache.
- [ ] **Special blocks not translated.** Tables, code, `$$` math, and charts in
  the dual view render once centered and are never sent for translation.
- [ ] **Translated-column wikilink card is Chinese.** Clicking a wikilink in the
  **right** (translated) column shows the preview card with its title + summary
  in Chinese and an `AI` badge; the same link clicked in the **left** column (or
  mono view) shows the original card, badge-free. An already-Chinese target page
  is shown as-is (no badge, no extra translate call). _e2e: `bilingual.spec.ts`
  "translates the preview card…"; unit: `WikiBilingual.test.tsx`._

## Copy (voice & content)

> Chrome copy follows `DESIGN.md` §9, adapted per locale. Core/user content is
> never rewritten by the web layer.

- [ ] **Actions = verb + noun.** Buttons/menu items name a verb and a noun
  (`Delete Session` / `删除会话`), never a bare `Confirm` / `OK` / `确定`.
- [ ] **Toasts.** Name the changed thing, drop `successfully`, drop the trailing
  period — `Session renamed` / `已重命名会话`, not `Successfully renamed…`.
- [ ] **Loading + empty states.** In-progress text uses the present participle +
  `…` (`Loading…` / `加载中…`); empty states point to the first action.
- [ ] **EN casing.** In `en`, buttons/nav/tabs are Title Case, body/helper text
  is sentence case; `zh-CN` uses natural phrasing (no Title Case).

## Surface-specific contracts

- [ ] **Base = source + knowledge only**; wisdom lives on `#wisdom`. _e2e: filtering._
- [ ] **Chat right rail is session-scoped** accumulated sources/tool calls — it
  does **not** filter when an assistant reply is clicked. Message/Sources/Tools
  lists each bottom-stick independently; a new message resets all three.
  _e2e: `chat.spec.ts`._
- [ ] **Tasks op gate** (Ingest/Synth/Lint Propose/Lint Apply) disables while any
  task is running/pending, independent of the Status/Op filter.
