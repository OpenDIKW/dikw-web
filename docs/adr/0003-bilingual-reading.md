# 3. Base reader bilingual (EN→中) parallel reading

The Base reader (`#base`) shows English pages as a single column. Readers who
work primarily in Chinese want the Chinese translation *alongside* the source,
paragraph by paragraph, without leaving the page. dikw-core does not translate,
so the translation is produced on demand by a dikw-web sidecar endpoint and
rendered as a second column. This ADR records the contract and the rendering
decisions that the feature was built and aligned against.

## Status

Accepted (2026-06-09). Backend `/web/translate` shipped first (PR #76); this ADR
covers the reader half. The visual/interaction contract is the committed mockup
`mockups/base-bilingual-reading.html`.

## Context

- Translation is **not** a dikw-core capability. It is a browser-side helper, so
  it lives under the same-origin sidecar `/web/*` namespace (like mineru) and
  never touches `/v1`. The backend is a **job + poll** API
  (`POST /web/translate/submit` → `202 { jobId }` → poll → `…/result`) so a slow
  whole-document LLM call survives a request-timeout proxy (issue #60).
- A page's language is unknown before it is fetched, so the reader cannot decide
  up front whether to offer translation.
- The mono reader already renders markdown through a single hand-rolled
  markdown-it instance with a strict sanitizer and post-render hydration
  (mermaid / ECharts / authenticated images). A second column must render
  through *exactly* that pipeline, or the two columns would diverge in
  sanitization, chart support, or asset resolution.

## Decision

**Block contract.** The browser splits the document body into ordered blocks
(`splitMarkdownBlocks`). Text blocks (paragraphs, headings, lists, quotes) are
translated; special blocks (fenced code incl. mermaid, pipe / raw-HTML tables,
`<details>` charts, `$$` display math, thematic breaks) are excluded. All text
blocks are sent in **one** request so the model has whole-document context for
coherent terminology; the response is aligned 1:1 by index (`{ blocks: [{ i, tr }] }`).

**Layout.** A paragraph-aligned dual column (`BilingualView`): source markdown
left, translation right, each text block rendered once per column. Special
blocks render **once, centered**, spanning neither column and never translated
— duplicating a chart or table per column would waste width and double-init
ECharts. Hovering a pair highlights it. Narrow screens (< 1100px) stack the two
columns instead of scrolling a cramped grid.

**Entry.** Language is detected *after* render via CJK ratio (`isEnglishBody`,
< 15% CJK letters → English). The EN→中 toggle appears only for English pages
**and** only when the sidecar translator is configured
(`GET /web/translate/health` → `{ enabled }`, probed once on mount). It is fused
onto the Read tab (a bonded `aria-pressed` half joined by a hairline seam), not a
separate header control. Chinese pages and a disabled translator show nothing
extra. No model name is shown anywhere.

**Shared renderer.** The markdown-it instance, sanitizer, and hydration were
extracted from `MarkdownView` into `markdown-runtime` so the mono and dual-column
views render identically. `renderMarkdownBlockHtml` renders one block at a time
while threading a shared heading-slug env across blocks, so a column's anchor ids
match a whole-document render. The translated column renders through a *prefixed*
env (`headingSlugPrefix: "tr-"`) so its heading ids cannot collide with the
source column's in the same DOM.

**Wikilinks.** A translated `[[target|label]]` keeps its `target`; only the label
is translated, and the server re-pins targets by order (`repinWikilinks`) so a
model rewrite can never break a link destination. Click delegation reports the
clicked side (source vs translated column) so a future change can show the
target's Chinese preview when the translated-column link is clicked.

**Caching / lifecycle.** Translations are cached in IndexedDB
(`dikw-translate-cache`, keyed by `sha256(targetLang + blocks)`, 7-day TTL) so a
repeat toggle is instant. The `useBilingualReader` hook owns split → translate →
map with abort, cancel, re-translate, and reset-on-page-change.

## Consequences

- One request per document (not per block) keeps the model's whole-document
  context but means the dual column reveals translations all at once rather than
  streaming block by block.
- The mono and dual-column views share one renderer, so future markdown features
  (new chart types, sanitizer changes) apply to both for free; the cost is that
  `markdown-runtime` is now a shared dependency that must stay behavior-preserving
  for `MarkdownView` (gated by `MarkdownView.test.tsx`).
- Translation quality and cost depend on the configured MiniMax model; the
  feature degrades cleanly to single-column when the translator key is absent.
- The translated-column wikilink preview is currently the source page (the
  `side` is plumbed through but not yet used to translate the preview); this is a
  deliberate follow-up, not a regression.
