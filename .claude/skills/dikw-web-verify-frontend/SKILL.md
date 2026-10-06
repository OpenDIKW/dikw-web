---
name: dikw-web-verify-frontend
description: Verify dikw-web UI changes end-to-end in a real browser before responding. Use whenever a page, component, route, typography, CSS, or design-token change is made (anything under src/pages, src/components, src/styles.css, or packages/web-ui). Two-pass loop — behavior, then the UI rubric — in light and dark mode, plus a measured a11y and perf pass when the DevTools MCP server is available.
---

# Verify frontend (dikw-web)

This skill turns "verify in the browser" into a repeatable pass.
**Fix issues and verify again before you respond to the user.** A green unit or e2e run does not prove that the change renders correctly with real data.

The deterministic gates (`npm.cmd run typecheck`, `npm.cmd run test:coverage`, `npm.cmd run test:e2e`) must already be green. This skill covers what they cannot:

- real-browser behavior,
- a clean runtime console on **real** data,
- the qualitative `docs/ui-checklist.md` rubric.

The e2e suite runs against a mocked `/v1`. This pass is where you see real rendering.

## Step 0 — Scope from the diff

Map the changed files to the `#routes` that you must check.
A change to `src/styles.css`, `packages/web-ui`, or shared chrome (`src/App.tsx`, top bar, sidebar) touches **every** route. Pick a few representative ones.
Route ↔ page (`src/App.tsx`):

| route | page | route | page |
|---|---|---|---|
| `#overview` | `OverviewPage` | `#wisdom` | `WisdomPage` |
| `#import` | `ImportPage` | `#retrieve` | `RetrievePage` |
| `#base` | `WikiPage` | `#chat` | `ChatPage` |
| `#graph` | `GraphPage` | `#tasks` | `TasksPage` |
| `#settings` | `SettingsPage` | `#trace` (hidden) | `TracePage` |

## Step 1 — Behaves as expected

1. **Reuse the dev server.** It is fixed at `http://127.0.0.1:4321` with `--strictPort`.
   If it runs, use it. If not, run `npm.cmd run dev`. Do not start a second one; strictPort makes it fail.
   Configure a real core URL in Settings. Without one, pages show connection notices. That is fine for chrome checks, not for data rendering.
2. **For each changed route, use the Chrome MCP tools** (`navigate`, `read_page`, `find`, `computer`, `browser_batch`).
   Exercise the route's key interaction and confirm that it renders. See the per-route cues below.
3. **Console gate.** `read_console_messages` with pattern `error` must be empty.
   Resource-load 404s and `AbortError` are expected noise (the same allowlist as `tests/e2e/harness.ts`).
   A `console.error` from app code or an uncaught exception is a fail. Fix it.

### Gotchas (each one can waste an hour)

- **`#graph` — do NOT use Chrome MCP for the Pixi canvas.** A background MCP tab stops `requestAnimationFrame`, so the canvas never builds and looks blank when it is fine.
  Check graph rendering with `npx playwright test graph.spec.ts --headed` instead.
- **Anything behind `requestIdleCallback`** (for example ImportPage's IndexedDB cache sweep) does not fire promptly in an MCP or DevTools tab. It only hits the timeout fallback.
  Wait past the timeout (about 11 s for a 10 s fallback) before you decide that it did not run.
- **Local proxy:** the shell has `HTTP_PROXY=127.0.0.1:1235`. A `curl` against the local dev server needs `--noproxy "*"`, or it can report a false 502.

### Per-route cues (key interaction → what to watch)

- **#overview** — mounts `/v1/health|info|status`; Refresh fetches again. The status pill color tracks health. The metric grid stays stable on refresh (no layout shift).
- **#base / #wisdom** — pick a page. The body renders without shift. Info / Outline / Source tabs work. Outline headings scroll. Images load (or show `.md-broken-image`). The Source tab inlines K-page wikilinks. Dark mode uses reader tokens, with no near-white block.
  On an **English** page with the translator enabled, toggle **AI 翻译** and run the "Bilingual reader" block in `docs/ui-checklist.md`:
  - figures appear once, centered (not once per column),
  - no paragraph stays English in the right column (watch the dev log for `[translate] … returned untranslated`),
  - the reveal is progressive,
  - a second toggle is an instant **已缓存** hit.
- **#chat** — send a message. The response streams. The right rail accumulates session-level sources and tools (it does **not** filter per reply). Panels stick to the bottom.
- **#graph** — (see the gotcha) legend visible; only search and hide-orphans; a click focuses the neighborhood; Open in Base navigates.
- **#import** — the picker filters unsupported formats with a notice. Office files show the converting → polling substage (when MinerU is enabled). The pipeline resumes on refresh. A failed conversion offers per-file Retry and Skip.
- **#tasks** — the list paginates. Op buttons disable while any task runs (independent of the filter). Stop cancels the selected task. A new op auto-selects and follows.
- **#settings** — Server URL and the masked token persist after Save (localStorage, `dikw-web.*`). Locale and theme persist (localStorage) and apply at once.

## Step 2 — Passes the UI rubric (light + dark)

Run **`docs/ui-checklist.md`** against each changed route, in both themes.
It is the pass/fail rubric for: single-language chrome, small radii and restrained shadows, no UI framework, dark reader contrast, graph filters / legend / no bloom, the Markdown HTML allow-list, and the surface contracts.
For an item marked "e2e: …", the gate already covers it. Run that spec again instead of checking by eye.

## Step 2.5 — Measured perf + a11y (Chrome DevTools MCP, when available)

This step replaces **eyeballed** a11y, contrast, and perf items with **measured** numbers.
It needs the Chrome DevTools MCP server (`lighthouse_audit`, `performance_start_trace` / `performance_stop_trace`, `performance_analyze_insight`).

- **If the server is not available in this session, mark Step 2.5 SKIPPED and say why.** `tests/e2e/perf.spec.ts` still gates CLS on the primary routes. Never report a score that you did not measure.
- Run it only for the route(s) that the diff touched.

Two different tools. Do not mix them up: **`lighthouse_audit` excludes performance**. A11y comes from Lighthouse; Web Vitals come from a performance trace.

1. Open the changed route at `http://127.0.0.1:4321/#<route>` in a DevTools MCP page (reuse the running dev server).
2. **Accessibility (+ best practices) → `lighthouse_audit`** with the **accessibility** and **best-practices** categories (**not** `performance`).
3. **Web Vitals → a performance trace.** `performance_start_trace` (reload = true, so the load is captured) → exercise the route → `performance_stop_trace`. Read CLS and LCP from the trace. Use `performance_analyze_insight` on the LCP / CLS insight for detail.
4. Score against this rubric (the budget is a floor, not a target):
   - **Accessibility ≥ 0.9**, and **no new violation** against `main` for the route. A lower score is a fail: fix the contrast, label, or role, and audit again. This puts a number behind the rubric's "contrast ≥ 4.5:1 body / 3:1 headings".
   - **CLS ≤ 0.1** — from the trace. `tests/e2e/perf.spec.ts` already gates it on the primary routes. Here it cross-checks the *changed* route, and the trace shows *which* element shifted.
   - **LCP** — from the trace; a **soft** budget. Record it and flag a clear regression against `main`. It depends on the runner, so `perf.spec.ts` only annotates it.
5. **Pixi `#graph` caveat (the same cause as the Step 1 gotcha):** a background DevTools tab can stall `requestAnimationFrame`, so a trace of `#graph` can capture a canvas that never animated.
   Trace graph perf only in a foreground page, or skip the trace there and rely on `graph.spec.ts`. The Lighthouse a11y audit is DOM-based and works on `#graph` normally.

These checks are measured locally. They are not CI gates, because Lighthouse and trace timing depend on the runner. A ❌ here feeds Step 4 like any other finding.

## Step 3 — (if the change touches core data shape) smoke the live contract

If the change reads a different `/v1` field or shape, the mocked e2e suite cannot catch real drift.
When a dikw-core is reachable, run **`dikw-web-smoke-core`** (`npm.cmd run smoke:core`) to check the consumed contract against the real core.
Skip it when the change is purely presentational.

## Step 4 — Close the loop

- Any ❌: fix the source, run the affected gate again, and check the route again.
- Report the UI change as done only when behavior (Step 1), the rubric (Step 2), and the measured pass (Step 2.5, or its stated SKIPPED) are clean in both themes.
- This skill is step 5 of `dikw-web-delivery-workflow`.
