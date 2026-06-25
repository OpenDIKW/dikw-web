# UI / UX refactor plan

A phased plan to bring the codebase in line with the enhanced `DESIGN.md`
design system — learned from Vercel's Geist system but keeping dikw-web's own
identity (warm-stone neutrals, single deep-petrol accent, hairline structure,
three-voice type, "The Quiet Instrument"). The mandate is **incremental
("additive"): keep existing token names and the `src/styles.css` structure; fill
gaps and unify scattered values; do not rewrite the color scale or add a UI
framework.**

This doc is the durable companion to `DESIGN.md` (the contract),
`docs/ui-system.md` (rendering contracts), and `docs/ui-checklist.md` (the
per-route pass/fail rubric).

## Why

Two empirical passes over the design system surfaced concrete gaps:

1. **No spacing scale** — spacing ran 1px–74px by hand, no `--space-*`.
2. **No motion scale** — 120/140/240ms scattered, no `--dur-*` / `--ease-*`.
3. **No typography role tokens** — 30-plus ad-hoc px sizes (10.5–32px), no
   display/title/body/label roles.
4. **State styling hand-picked per element** — hover/active colors hardcoded as
   literals (`#cbd8d4`, `#c5dad5`, `#9fb0aa`, …) instead of read off a table.
5. **Hand-rolled component duplication** — no shared `Button` / `IconButton` /
   `Field`; `secondary-button` markup written 29×, `primary-button` 11×,
   `icon-button` 12×, `field` 10×.
6. **A real bug** — `--danger` was referenced (`.secondary-button--danger`,
   `.agent-session-menu__item--danger`) but never defined in `styles.css`, so
   destructive control text silently fell back to its inherited color.
7. **Doc-vs-code drift** — `DESIGN.md` claimed 6px control radius (shipped 7px),
   serif page titles (shipped Inter Tight 30px sans), and a 25%-alpha pill
   border (shipped none).

## Phase 0 — Design system foundation (this round, landed)

Token layer + documentation. Pure addition except the one bug fix.

- **`src/styles.css`** — add `--danger: var(--red)` (the bug fix; the only
  intended visual change — destructive text becomes red), plus additive,
  not-yet-consumed token groups: `--space-*` (4px grid + 6/10/14 half-steps),
  `--dur-*` / `--ease-*` (motion), `--type-<role>-{size,lh,ls}` (six roles), and
  alpha tokens (`--line-alpha`, `--overlay-hover`, `--accent-border-hover`, …)
  built with `color-mix` so they track the theme with no dark override.
- **`DESIGN.md`** — restructured to a Geist-style section order (Overview,
  Colors + Intent Mapping, Typography + Type Roles, Spacing & Rhythm, Elevation,
  Motion, Shapes, Components, Voice & Content, Do's/Don'ts), reconciled to the
  **real** shipped values, with a new bilingual Voice & Content section.
- **`docs/ui-system.md`** — token references kept in sync.
- **`docs/ui-checklist.md`** — new checkable items where the spec tightened.

The new spacing/motion/type/alpha tokens are **defined now, consumed
incrementally** in later phases — defining them makes the doc and the code
agree; CSS migration to consume them is not forced through the 7000-line
stylesheet in one pass.

## Phase 1 — First shared controls (this round)

Extract the highest-leverage hand-rolled components as **DOM-identical wrappers**
of the existing CSS classes — zero CSS diff, so the e2e console gate, CLS budget,
and the visual rubric are provably unaffected. TDD: each component's tests land
before its call-sites migrate, so coverage only rises.

New components under `src/components/`:

- **`cx(...classes)`** — a tiny class-name joiner; `cx(base, props.className)`
  so a call-site's extra classes survive the wrap. Tested first.
- **`Button`** — `variant: 'primary' | 'secondary' | 'danger'`, optional
  `icon`, `...rest` passthrough. **Defaults `type="button"`** (a missing type
  inside a form submits and trips the console gate). `danger` is a prop, not a
  className. Wraps `.primary-button` / `.secondary-button`
  (`styles.css:542–580,926`). Replaces ~40 call-sites.
- **`IconButton`** — required `label` → `aria-label`, optional `iconSize`,
  **appending** className passthrough (e.g. `ChatPage`, `WisdomPage` carry extra
  classes). Wraps `.icon-button` (`styles.css:582`). Replaces ~12 call-sites.
- **`Field`** — `<label class="field">` + `<span>` label + native control;
  modifiers `--grow` / `--small` / `--inline` / `--token`. Native
  `input`/`select`/`textarea` are already globally styled
  (`styles.css:503–531`), so no separate Input component. Wraps `.field`
  (`styles.css:480`). Replaces ~10 call-sites.

**Migration order** (each step a TDD loop, verified with
`npx vitest run <file>` + `npm run typecheck`): baseline green → `cx` → `Button`
→ `IconButton` → `Field` → migrate `SettingsPage` (most form/submit/disabled
nuance, the pilot) → IconButton sweep (mind `ChatPage` submit + extra-class
sites) → remaining Button sweep page-by-page incl. `TasksPage` danger and
`import/*` → full gate (`npm run verify`) → browser verify (light + dark) on the
migrated routes.

**Explicitly out of Phase 1:**

- **Tree-indent helper** — not a real inconsistency. Both `WikiPage` and
  `WisdomPage` already use `paddingLeft: 10 + depth*16`; `TracePage`'s `depth*14`
  is a span waterfall and `WikiPage`'s outline `(level-1)*10` is heading depth —
  different patterns, not duplication.
- **Badge unification** — a 30-site `.soft-label` sweep plus the temptation to
  merge `.soft-label` / `.frontmatter-chip` CSS (which would change pixels). Its
  own phase.

## Phase 2 — Badges, segmented control, literal migration

- **`SoftLabel`** and **`FrontmatterChip`** as separate wrappers — keep
  `StatusPill` as the already-shared status component; **do not merge** the three
  CSS classes (they are visually distinct).
- **`SegmentedControl`** — extract the Settings theme/locale pattern.
  `WikiReaderTabs` and MB-Web's `.mb-seg` are too bespoke to fold in.
- **Literal → token migration** — replace `#cbd8d4` / `#c5dad5` / `#9fb0aa` /
  `#3c4a46` / `#1d2926` / `#25322f` with the alpha tokens and the Intent Mapping
  ramp; consume the `--space-*` / `--type-*` tokens in the CSS rules that match
  them; collapse the duplicate `.page-header h1` and NavItem base/override rules.
  Verify route-by-route in light + dark.

## Phase 3 — Panels, MB-Web, optional consolidation

- **`Card` / `Panel`** — opt-in wrapper with an `as` prop.
- **MB-Web adoption** — let the shared controls serve `src/mb/` via `className`
  passthrough only; MB keeps its `.mb-` namespace (no forced CSS merge).
- **List items** — `.citation-item` / `.result-table__row` / `.event-tape__item`
  are genuinely different components, not duplication; a generic `ListItem` is a
  non-goal unless a real shared shape emerges.

## Invariants (every phase)

- No UI framework (no Tailwind/Radix/shadcn) — plain React + `styles.css` tokens.
- Single-language chrome per locale; don't reintroduce removed surfaces (Query
  UI, graph layer-scope toggle).
- e2e console gate stays green (zero `console.error` / `pageerror`).
- Coverage thresholds hold (statements 60 / branches 45 / functions 55 /
  lines 60); bundle budget holds (`npm run check:bundle`).
- Surgical changes — every changed line traces to the goal; pre-existing
  unrelated findings are left alone, not opportunistically "improved".
