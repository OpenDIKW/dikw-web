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
`<details>` charts, `$$` display math, thematic breaks, and **standalone image
lines** — a figure alone on a line, `![[…]]` or `![](…)`) are excluded. Detection
is at the *line* level, not the blank-line block, so a figure is split off even
when a **hard line break** (not a blank line) joins it to its caption — the shape
MinerU emits for captioned figures (the Fig. 2 case on cho-cqa, where the image
otherwise rode along inside the caption's text block and rendered in both
columns). A line mixing prose and an inline image stays translatable text — as does a
bare-image **list-item / blockquote** line (`- ![](…)`, `> ![](…)`), since
pulling it out would break the surrounding list/quote; only a standalone
image-only line is special. The text
blocks are sent in **one** submit, but the sidecar translates them in **ordered
batches** (`splitIntoBatches`, capped by block count / character budget — one
streaming LLM call per batch) so the first paragraphs return in seconds instead
of after the whole document. Per-batch results accumulate into the 1:1-by-index
result (`{ blocks: [{ i, tr }] }`), and each poll's status carries the blocks
translated so far (`progress: { done, total, blocks }`) so the reader fills the
column progressively as batches land.

**Layout.** A paragraph-aligned dual column (`BilingualView`): source markdown
left, translation right, each text block rendered once per column. Special
blocks render **once, centered**, spanning neither column and never translated
— duplicating a chart, table, or **figure** per column would waste width,
double-init ECharts, and (for images) translate only the alt text into a
meaningless second copy. Hovering a pair highlights it. Narrow screens (< 1100px) stack the two
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

- Batched translation (several paragraphs per LLM call) reveals the dual column
  progressively — the reader fills paragraphs as each batch lands instead of
  waiting for the whole document, and the sidecar logs per-batch timing. The
  tradeoff is some loss of cross-batch terminology consistency, bounded by the
  batch size (`MAX_BLOCKS_PER_BATCH` / `MAX_CHARS_PER_BATCH`).
- The mono and dual-column views share one renderer, so future markdown features
  (new chart types, sanitizer changes) apply to both for free; the cost is that
  `markdown-runtime` is now a shared dependency that must stay behavior-preserving
  for `MarkdownView` (gated by `MarkdownView.test.tsx`).
- Translation quality and cost depend on the configured MiniMax model. The
  translator reuses the chat agent's `DIKW_AGENT_*` credentials (no dedicated
  key), so the feature degrades cleanly to single-column when `DIKW_AGENT_API_KEY`
  is absent.
- Each batch is a streaming call (`messages.stream(...).finalMessage()`) using a
  **delimiter** wire protocol — the blocks are joined by a distinctive sentinel
  line and the reply is split back on it — **not** a JSON array. A JSON array
  corrupts on real scientific Markdown: LaTeX backslash commands (`\circ`,
  `\mathrm`) are invalid JSON escapes, and unescaped quotes around code
  identifiers (`"scikit-learn"`) break string boundaries — both were
  live-observed failing every batch that contained them, on the cho-cqa paper.
  A delimiter needs no escaping, so any character round-trips verbatim.
- A **wrong block count** from the model is reconciled by splitting the batch and
  re-translating the halves down to singletons (a singleton's pieces are joined),
  **not** by re-asking the identical call — the miscount is often deterministic
  (the model keeps merging the same adjacent pair). This matters under batching:
  any one batch could otherwise fail the whole job. The sidecar retries transport
  faults and an empty reply with exponential backoff, and logs per-batch timing
  (`[translate] job … batch k/N … ok in …ms`) plus any split, so a slow or
  failing run is visible.
- A block whose translation carries content it shouldn't is treated as a likely
  **hallucination / echo** and repaired. Two signals (above a 60-char floor, so
  short blocks that legitimately expand are exempt): the translation **contains
  the whole source block verbatim** (the model echoed the English and appended a
  translation), or it is **more than ~2× the source length** (EN→中 compresses, so
  that is implausible — live-observed on test2.md: a reference translated, then an
  unrelated paragraph + a fabricated section outline tacked on; and a reference
  echoed bilingually with an invented link). The block is re-asked alone once, and
  — crucially — the re-ask result is **re-validated**: a result that is still
  oversized/echoed is rejected in favour of the **source text** rather than
  injecting bloat. (This catches the case where the *untranslated* repair's re-ask
  comes back as a bilingual echo.) The system prompt also explicitly forbids
  adding, continuing, summarizing, or inventing content. `repairBlocks` handles
  the untranslated and oversized/echo cases together, bounded to one re-ask per
  block. Because the translation logic changed, the browser cache version was
  bumped so stale pre-fix translations are re-fetched.
- A block the model **echoes back untranslated** (returns its English source even
  though the batch count matched, so the split path never sees it) is caught by a
  post-batch check: for a Chinese target, a source with ≥ 6 English words whose
  translation contains no CJK is re-asked **alone** once (focused context usually
  translates it) and the result accepted regardless — bounded to one re-ask so a
  genuinely un-translatable block can't loop the job. Short non-prose (citations,
  acronyms, identifiers, captions) is below the word threshold and left as-is.
  This was live-observed on cho-cqa (a long Methods paragraph came back English).
- The translated-column wikilink preview is currently the source page (the
  `side` is plumbed through but not yet used to translate the preview); this is a
  deliberate follow-up, not a regression.
