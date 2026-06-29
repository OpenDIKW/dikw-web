---
name: dikw-web-verify-frontend
description: Verify dikw-web UI changes end-to-end in a real browser before responding. Use whenever a page, component, route, typography, CSS, or design-token change is made (anything under src/pages, src/components, or src/styles.css). Two-pass loop — behavior, then the UI rubric — in light and dark mode.
---

# Verify frontend (dikw-web)

Turn the prose "verify in the browser" step into a repeatable pass. **Fix issues
and re-verify before responding to the user** — a green unit/e2e run is not the
same as the change actually rendering correctly with real data.

Deterministic gates (`npm.cmd run typecheck`, `npm.cmd run test:coverage`,
`npm.cmd run test:e2e`) are assumed already green — this skill covers what those
can't: real-browser behavior, runtime console cleanliness on **real** data, and
the qualitative `docs/ui-checklist.md` rubric. The e2e suite runs against mocked
`/v1`; this pass is where real rendering gets seen.

## Step 0 — Scope from the diff

Map changed files to the `#routes` you must check. A change to `src/styles.css`
or shared chrome (`src/App.tsx`, top bar, sidebar) touches **every** route — pick
a representative few. Route ↔ page (`src/App.tsx`):

| route | page | route | page |
|---|---|---|---|
| `#overview` | `OverviewPage` | `#wisdom` | `WisdomPage` |
| `#import` | `ImportPage` | `#retrieve` | `RetrievePage` |
| `#base` | `WikiPage` | `#chat` | `ChatPage` |
| `#graph` | `GraphPage` | `#tasks` | `TasksPage` |
| `#settings` | `SettingsPage` | `#trace` (hidden) | `TracePage` |

## Step 1 — Behaves as expected

1. **Reuse the dev server.** It is fixed at `http://127.0.0.1:4321` with
   `--strictPort`. If it's already up, use it; otherwise `npm.cmd run dev` (don't
   spawn a second — strictPort will just fail). A real core URL is configured in
   Settings; without one, pages show connection notices, which is fine for chrome
   checks but not for data rendering.
2. **Per changed route, via Chrome MCP** (`navigate`, `read_page`, `find`,
   `computer`, `browser_batch`): exercise the route's key interaction and confirm
   it renders. See the per-route cues below.
3. **Console gate.** `read_console_messages` with pattern `error` must be empty.
   Resource-load 404s and `AbortError` are expected noise (same allowlist as
   `tests/e2e/harness.ts`); a `console.error` from app code or an uncaught
   exception is a fail — fix it.

### Gotchas (these will waste an hour if you forget)

- **`#graph` — do NOT use Chrome MCP for the Pixi canvas.** A background MCP tab
  halts `requestAnimationFrame`, so the canvas never builds and you'll "see" a
  blank graph that's actually fine. Verify graph rendering with
  `npx playwright test graph.spec.ts --headed` instead. If that one Pixi test
  fails in CI/headless but passes `--headed`, it's the known flake — rerun once,
  don't chase it. (memory: `project_flaky_graph_e2e`)
- **Anything behind `requestIdleCallback`** (e.g. ImportPage's IndexedDB cache
  sweep) never fires promptly in an MCP/devtools tab — it only hits the timeout
  fallback. Wait past the timeout (e.g. ~11s for a 10s fallback) before
  concluding it didn't run. (memory: `reference_ric_mcp_tab`)
- **Local proxy:** the shell has `HTTP_PROXY=127.0.0.1:1235`; `curl` against the
  local dev server needs `--noproxy "*"` or it may falsely report 502.
  (memory: `reference_local_proxy`)

### Per-route cues (key interaction → what to watch)

- **#overview** — mounts `/v1/health|info|status`; Refresh re-fetches. Status pill
  color tracks health; metric grid stable on refresh (no layout shift).
- **#base / #wisdom** — pick a page; body renders without shift; Info/Outline/
  Source tabs work; outline headings scroll; images load (or `.md-broken-image`);
  Source tab inlines K-page wikilinks. Dark = reader tokens, no near-white block.
  On an **English** page with the translator enabled, toggle **AI 翻译** and run
  the "Bilingual reader" block in `docs/ui-checklist.md`: figures appear once
  centered (not duplicated per column), no paragraph stays English in the right
  column (watch the dev log for `[translate] … returned untranslated`), reveal is
  progressive, and a re-toggle is an instant **已缓存** hit.
- **#chat** — send a message; response streams; right rail accumulates
  session-level sources/tools (does **not** filter per reply); panels bottom-stick.
- **#graph** — (see gotcha) legend visible; search + hide-orphans only; click
  focuses neighborhood; Open in Base navigates.
- **#import** — picker filters unsupported formats with a notice; office files
  show the converting → polling substage (mineru enabled); pipeline resumes on
  refresh; failed conversion offers per-file Skip.
- **#tasks** — list paginates; op buttons disable while any task runs (filter-
  independent); Stop cancels the selected task; new op auto-selects + follows.
- **#settings** — Server URL / masked token persist (sessionStorage); locale +
  theme persist (localStorage) and apply immediately.

## Step 2 — Passes the UI rubric (light + dark)

Run **`docs/ui-checklist.md`** against each changed route, in both themes. It is
the pass/fail rubric for single-language chrome, small radii / restrained shadows,
no-UI-framework, dark reader contrast, graph filters/legend/no-bloom, the
markdown HTML allow-list, and the surface contracts. Items it marks "e2e: …" are
already gated — for those, re-run that spec instead of eyeballing.

## Step 2.5 — Measured perf + a11y (Chrome DevTools MCP)

Turn the **eyeballed** a11y / contrast / perf items of the rubric into a *measured*
pass against numbers, not vibes. Use the **`chrome-devtools-mcp`** plugin (already
installed — `lighthouse_audit`, `performance_start_trace` / `performance_stop_trace`,
`performance_analyze_insight`; skills `chrome-devtools-mcp:a11y-debugging` and
`debug-optimize-lcp`). This is the verification step the Chrome MCP interaction pass
(Step 1) can't give you. **Run it for the route(s) the diff touched**; skip a route the
change can't affect.

Two different tools — don't conflate them: **`lighthouse_audit` excludes performance**
(its tool reference directs perf to the trace tools), so a11y comes from Lighthouse and
Web Vitals come from a performance trace.

1. Open the changed route in a Chrome DevTools MCP page at
   `http://127.0.0.1:4321/#<route>` (reuse the running dev server).
2. **Accessibility (+ best-practices) → `lighthouse_audit`.** Run it with the
   **accessibility** and **best-practices** categories (**not** `performance` — the tool
   excludes it). The `a11y-debugging` skill walks specific failures (semantic HTML, ARIA
   labels, focus order, tap-target size, contrast ratios).
3. **Web Vitals → a performance trace.** `performance_start_trace` (reload = true so the
   load is captured) → exercise the route → `performance_stop_trace`; read CLS + LCP from
   the trace, and use `performance_analyze_insight` on the LCP/CLS insight for detail.
   (The `debug-optimize-lcp` skill covers this flow.)
4. Score against this rubric (the budget is a floor, not a target):
   - **Accessibility ≥ 0.9**, and **no new violation** vs `main` for the route — from the
     Lighthouse pass. Treat a dropped score as a fail; fix the contrast / label / role and
     re-audit. This backs the rubric's "contrast ≥ 4.5:1 body / 3:1 headings" with a number.
   - **CLS ≤ 0.1** — from the trace. Already gated by `tests/e2e/perf.spec.ts` on the
     primary routes; here it's a cross-check on the *changed* route, and the trace shows
     *which* element shifted so a regression is fixable, not just flagged.
   - **LCP** — from the trace; a **soft** budget: record it and flag a clear regression vs
     `main`, but it's runner-dependent (annotated, not hard-gated, in `perf.spec.ts`).
5. **Pixi `#graph` caveat (same root cause as Step 1's gotcha):** a background
   DevTools MCP tab can stall `requestAnimationFrame`, so a performance trace of `#graph`
   may capture a canvas that never animated. Trace graph perf only in a foreground page,
   or skip the trace there and rely on `graph.spec.ts` for its render contract. The
   Lighthouse accessibility audit (DOM-based) is unaffected — the node overlay exposes
   stable button targets, so run a11y on `#graph` normally.

These are **measured-locally** checks, not new CI gates (Lighthouse + trace timing is
runner-dependent — the same reason `perf.spec.ts` gates only CLS). A ❌ here feeds Step
4's loop like any other finding.

## Step 3 — (if the change touches core data shape) smoke the live contract

If the change reads a different `/v1` field/shape, the mocked e2e suite can't
catch real drift. When a dikw-core is reachable, invoke **`dikw-web-smoke-core`**
(`npm.cmd run smoke:core`) to assert the consumed contract against the real core.
Skip when the change is purely presentational.

## Step 4 — Close the loop

Any ❌ → fix the source, re-run the affected gate, re-verify the route. Only
report the UI change done once behavior (Step 1), the rubric (Step 2), and the
measured perf + a11y pass (Step 2.5) are clean in both themes. This skill is Step 5
of the `dikw-web-delivery-workflow`.
