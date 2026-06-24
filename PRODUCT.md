# Product

## Register

product

## Users

Individual researchers and knowledge workers who build and interrogate a
personal DIKW knowledge base. Their context is sustained, focused work:
reading documents, tracing links across a graph, conversing with a
retrieval agent, and importing source material. They return to the tool
repeatedly and value density and precision over hand-holding. They are
not casual visitors — every screen is a workspace they already understand.

## Product Purpose

`dikw-web` is a knowledge workbench layered over `dikw-core`. It lets a
single researcher read source/knowledge/wisdom pages, explore the active
knowledge graph, run a retrieval agent, and drive the import → ingest →
synth → lint pipeline. Success is the interface getting out of the way:
the knowledge is the subject, the chrome is the instrument. The tool wins
when a user can inspect, verify, and act on their knowledge without the UI
demanding attention for itself.

## Brand Personality

Calm, precise, trustworthy. The voice is quiet and exact — a professional
instrument, not a marketing surface. It never shouts, never decorates for
effect, and never overstates. Confidence comes from craft and consistency:
a researcher should trust the tool the way they trust a well-made
reference work or a precise measuring instrument.

## Anti-references

- **Generic SaaS dashboards** — multi-color status cards, hero-metric
  walls (big number + small label + gradient), heavy drop-shadow card
  grids.
- **AI-generated template looks** — cream/sand body backgrounds with big
  serif display + terracotta accent, tiny tracked uppercase eyebrows above
  every section, 01/02/03 numbered scaffolding used as decoration.
- **Heavy decoration / motion** — glassmorphism, glow/bloom, gradient
  text, large entrance animations, ambient effects that don't serve the
  content.
- **Crowded / flashy** — neon palettes, multiple competing accent colors,
  oversized radii, icon-everywhere decoration.

## Design Principles

- **Quiet by default.** The chrome recedes so the knowledge is the hero.
  No element competes with content for attention without a reason.
- **Dense, never crowded.** Built for repeated expert use: high
  information density earned through rhythm, alignment, and restraint — not
  through cramming. Whitespace is structural, not decorative.
- **Precision earns trust.** Every spacing, weight, and alignment decision
  is deliberate. Consistency across pages is the feature; one-off colors,
  stray radii, and slop break the instrument's credibility.
- **Honest surfaces.** Show real data and real state. No fake metrics, no
  decorative numbers, no fabricated emphasis. The token never appears; the
  connection posture is stated plainly.
- **Inspectable.** Make it easy to read, trace, and verify — linked
  references, graph provenance, trace waterfalls. The design serves
  inspection over persuasion.

## Accessibility & Inclusion

WCAG AA. Body text ≥ 4.5:1, large text ≥ 3:1, metadata/control text ≥ 3:1
against their backgrounds — the contract the reader E2E checks already
lock. Full light + dark parity (`html[data-theme]`). Honor
`prefers-reduced-motion` with a crossfade or instant fallback for any
motion. Keyboard-reachable controls, including a stable accessible DOM
overlay for graph nodes behind the Pixi canvas.
