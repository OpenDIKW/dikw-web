# Markdown denial-of-service regression verification

## Scope

CodeQL reported six open `js/polynomial-redos` high-severity alerts on
`a07b2530af57426fc48ed41605c7ba70e3945ea2`: alerts 3–8 cover heading wikilinks,
details in the outline and reader, standard/Obsidian image references and chart
row whitespace. The fixes ship in workbench `0.12.4` and shared cohort `0.1.4`.

Forward scans cache delimiters and failed searches. Standard image destinations
index titles and line/parenthesis endings once, including malformed overlapping
openers. Details matching preserves the exported RegExp-compatible `exec`,
`matchAll`, `replace`, captures and UTF-16 offsets; the bilingual block splitter
uses the object directly. Details preprocessing stores numeric bounds for every
opener in O(n), including nested openers. Matching from arbitrary `lastIndex`
uses O(log m) lookup; normal matching takes O(n + k log m), without rescanning
tails or storing overlapping content strings. Chart rows use `trimEnd`.

## Deterministic checks

`scripts/markdown-redos.test.mjs` executes each adversarial family in a child
process with a three-second wall-clock limit. A child can be terminated even if
the parser blocks its own event loop. Cases include 60,000 repeated unclosed
image/wikilink openers, 60,000 repeated summary endings, overlapping malformed
image destinations and repeated parsing of 120,000 whitespace characters.
The normal import-only control completes comfortably within the limit.
An independent baseline replay with the same compiled-module imports took
approximately 0.18 seconds for the control; all five legacy adversarial families
exceeded the three-second limit.

Behavior regressions cover Core-compatible image paths, optional quoted titles,
parentheses in titles, aliases, source offsets, malformed-input recovery,
Unicode/case-insensitive details, safe attributes, charts and outline/render
agreement. A local deterministic differential harness also compares 30,000
short image/wikilink inputs and 10,000 details inputs with the prior grammar.
Independent read-only review additionally checked randomized/finite destination
grammars, arbitrary details start offsets, `split` and mutable match results.
Its final pass reported no remaining actionable findings.

The final local gate passed 1,399 unit tests and 67 browser tests (two existing
manual live-tool checks remain skipped), plus lint, formatting, types, coverage,
production build, isolated package consumers, bundle budgets and gate integrity.
The production dependency audit passed its unchanged high-severity threshold.
Independent review, hosted CodeQL and registry evidence are recorded
in the associated pull request and release run. No scans are dismissed or
suppressed, and verification thresholds and required checks remain unchanged.

## Downstream handoff

The user authorized `mbweb-work` to inspect and fix similar private application
code, then adopt the three exact registry versions together after publication.
The public repository does not check out private source or receive private
credentials. Stopped local deployments remain stopped; verification services
are isolated and cleaned up by their owning workflow.
