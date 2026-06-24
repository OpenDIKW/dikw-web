# UI Audit Backlog

Findings from a full interaction walkthrough against a **live `dikw-core`**
(GHCR 0.6.1 + Postgres, seeded via the import→ingest→synth→lint pipeline) plus
the `impeccable` static detector. Walkthrough covered every primary route in
light **and** dark, the hidden surfaces, and the MB-Web variant.

Severity: **P1** clear defect (reads as broken) · **P2** quality gap ·
**P3** minor polish. Each item notes the proposed fix and whether it aligns
with [`DESIGN.md`](../DESIGN.md) / [`PRODUCT.md`](../PRODUCT.md).

### Status

- **Shipped** (keyboard-focus PR): focus-token unification (`docs/ui-system.md`).
- **Resolved** (audit-fix PR): both P1s (Page Refs separator, Chunks PATH/SEQ
  collision), reader max-measure, Wisdom empty state, MB-Web palette alignment,
  the `.mb-anno` side-stripe callout, Graph `links` plural, Retrieve page-refs
  empty-state parity. Each is checked off inline below.
- **Resolved** (Enter-to-send PR): Chat Enter-to-send — `Enter` sends,
  `Shift+Enter` newlines, IME-composition guarded.
- **Resolved** (P3-polish PR): Chat idle Stop glyph (Stop now shows only while
  streaming) and Tasks card-in-card (metric tiles are borderless recessed wells,
  warn/error borders kept explicit). Both verified in light + dark on live core.
- **Open** (deferred — judged not worth a sweep): the advisory radius
  (7px→6px control unification) and color one-off promotions. See Advisories.

**Correction:** the `styles.css` "side-tab callout" originally listed below was
on inspection a **blockquote** (left rule = standard quote convention), not a
callout — see the revised Static-findings section.

## Interaction findings (live walkthrough)

### P1 — reads as broken

- **[Retrieve / Page Refs] Title and layer label run together with no
  separator.** Cards render `Knowledge` + `knowledge` as `Knowledgeknowledge`,
  `Knowledge and Wisdom` + `source` as `Knowledge and Wisdomsource`. The bold
  title abuts the regular-weight layer name with zero spacing — looks like a
  string-concat bug. *Fix:* separate the layer into a muted tag/pill or add a
  gap/line break. (`src/pages/RetrievePage*`)

- **[Retrieve / Chunks table] Long PATH collides with the SEQ column.** On
  rows where the path is long (`knowledge/concept/knowledge.md`), the path's
  right edge touches the SEQ value (`0`) with no column gap — they visually
  merge. *Fix:* constrain the PATH cell (truncate/ellipsis or wrap) and/or add
  column padding so PATH never bleeds into SEQ.

### P2 — quality gap

- **[Base reader + Chat] Body prose has no max measure.** On a wide viewport
  the reader body runs the full ~1340px column (>100 characters per line),
  well past the 65–75ch readability cap that both `DESIGN.md` (Typography →
  Body) and `PRODUCT.md` call for. Confirmed in light and dark. *Fix:* cap the
  reader/answer content column (e.g. `max-width: ~72ch`); keep tables/code
  full-width.

- **[Wisdom] Empty-state copy conflates "empty" with "no filter match".**
  With zero wisdom pages in the base (no filter active) the directory still
  shows *"No wisdom pages match"*, implying a filter mismatch. `PRODUCT.md`
  asks empty states to teach. *Fix:* distinguish the true zero-state ("No
  wisdom pages yet — create one with **+ New**") from a filtered no-match, and
  let the right pane echo the CTA instead of a dead-end "Select a wisdom page".

- **[Chat composer] Enter does not send.** Plain `Enter` (focus in the
  textarea, text present) does not submit; only the Send button works. Enter-
  to-send (with Shift+Enter for newline) is the dominant chat convention.
  *Decision needed:* if Enter-to-send is intended, wire it; if explicit-send is
  deliberate (multi-line composer), add a visible hint. (`AgentComposer`)

- **[MB-Web] Accent diverges from the workbench identity.** MB-Web's active
  tab / primary actions use a forest green (`#125330`, light-green fill
  `rgb(217,239,223)`) while the workbench accent is teal petrol `#0d5e57`.
  Two different hues across one product violates the **One Indicator Rule**
  (`DESIGN.md` Colors). Root `--accent` is still petrol; `src/mb/mb.css`
  overrides it. *Fix:* align MB-Web's accent to the shared petrol token.

### P3 — minor polish

- **[Chat composer] Idle Stop button is an unlabeled empty square.** Next to
  Send, the Stop control renders as a bare square with no glyph when idle
  (it has an accessible name, but no visible affordance). *Fix:* give it a
  stop glyph or hide it until streaming. **DONE** — hidden until streaming
  (`{running ? <Stop/> : null}`); the idle composer is just textarea + Send.
- **[Retrieve] Empty-state inconsistency.** "No chunks yet" has teaching
  subtext; "No page refs" is bare. Match them.
- **[Graph] Toolbar copy.** `16 LINK` should read `16 LINKS` (or keep singular
  deliberately as a terse mono label — pick one and apply consistently).
- **[Tasks] Card-in-card nesting.** The Result metric tiles are bordered boxes
  inside the bordered detail panel (`DESIGN.md`: never nest a card in a card).
  *Fix:* make the inner tiles borderless (tonal fill) or drop the panel border.
  **DONE** — metric tiles (`.task-summary-grid div`, `.summary-metric`) are now
  borderless recessed wells and `.result-summary` is a seamless grouping on the
  panel surface; `--warn`/`--error` borders kept explicit. Light + dark verified.

## Static detector findings (`impeccable`)

90 findings across `src/styles.css` + `src/mb/mb.css`. Triaged below — most
advisories are acceptable one-offs; the actionable subset is small.

### Warnings

- **side-tab (5)** — colored side-stripe borders. Re-inspected; only one was a
  genuine callout.
  - `mb.css` `.mb-anno` (annotation callout) — 3px accent `border-left` +
    asymmetric radius. **Real → FIXED**: reworked to a full accent-tinted
    border + full radius (the `我的批注` label + tint still set it apart).
  - `styles.css` `.agent-message--assistant .markdown-body blockquote` (the
    line first listed as a "callout") — on inspection this is a **blockquote**,
    not a callout. **Accept** — left rule is standard quote convention.
  - `mb.css` `.mb-quote` — serif quote with a **neutral** (`--border2`) left
    rule, not an accent stripe. **Accept** — standard quote styling.
  - `styles.css:1558` — `.markdown-body blockquote` left border. **Accept** —
    blockquote left rules are standard typographic convention, not the card
    side-tab tell. (`DESIGN.md`'s ban targets cards/callouts/alerts.)
  - `styles.css:1927` — `.bi-block--tr` 2px translated-column marker.
    **Accept (intentional)** — a functional bilingual reading aid.
- **layout-transition (3)** — `styles.css:2812`, `styles.css:3051`,
  `mb.css:382`: all `transition: width` on a pill-shaped accent **progress
  fill**. **Accept** — animating width is the correct, conventional way to
  drive a determinate progress bar; not layout thrash worth reworking.

### Advisories

- **design-system-radius (25)** — radii off the documented `4/6/8/999` scale.
  The genuine drift is the **7px** control radius (buttons/inputs) sitting
  between the 6px and 8px majority, plus assorted 1/2/5px and mb.css values.
  *Optional:* unify controls to 6px. Chat bubbles (10/14px) and large icon
  tiles (12/14px) are intentional and documented — leave them.
- **design-system-color (57)** — hex values not in `DESIGN.md`. Mostly
  legitimate one-off interaction shades (e.g. `#9fb0aa` hover border, `#c5dad5`
  segmented active border) and the edge-line shadow rgba. The actionable one is
  the **MB-Web green** (see the MB-Web finding above); the rest can stay or be
  promoted to tokens opportunistically — not worth a sweep.

## Suggested order of attack

1. P1 Retrieve Page-Refs separator + Chunks PATH/SEQ collision (quick, clear).
2. P2 reader max-measure (one rule, lifts Base + Chat readability).
3. P2 MB-Web accent alignment + the real side-tab callout (`styles.css:5108`,
   mb.css 984/1011) — same "no stray accent" theme.
4. P2 Wisdom empty state + Chat Enter-to-send decision.
5. P3 batch (Stop glyph, empty-state parity, Graph copy, Tasks nesting,
   optional 7px→6px radius unification).
