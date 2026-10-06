# Scientific reader markup — issue #226

The workbench `0.12.3` and exact shared cohort `0.1.3` repair existing converted
documents at render time; no conversion, source rewriting or Core change is
required. `html: false` remains enabled. A shared client inline rule recognizes
only attribute-free, case-insensitive, single-line `sup`/`sub` pairs. It indexes
balanced pairs once and isolates their inline parse so existing math, wikilink
and image rules cannot read past the closing tag. Ordinary tokens retain image
alternative text, Markdown link validation and typography behavior.

Raw tables preserve `sup`, `sub`, `i`, `em`, `b` and `strong` with no attributes.
Unsupported elements are sanitized recursively and unwrapped; their text remains
inert, including any script source text. Heading outlines and anchors strip only
accepted scientific tags, preserving code and unsupported markup literally.

## Regression and review

- Reproduced literal inline tags, lost table values (`10`, empty, `HO`) and
  `resultssupsup` heading anchors before implementation.
- Five focused reader/client files: 90 tests passed, including citations,
  exponents, chemical formulas, Markdown contexts, bilingual alignment, duplicate
  anchors, unsafe attributes/HTML/URLs, code and shared block environments.
- Independent review found and verified fixes for nested links, custom-rule
  overreads, nested/unclosed tags, image alternative-text loss and quadratic
  malformed-input scanning. Its final review found no actionable issue; an
  independent 80 KB unclosed-tag probe completed in approximately 19 ms.
- `tests/fixtures/scientific-markdown.json` is reused in reader tests, both-theme
  workbench e2e and packed/registry package consumers. Consumers can copy it from
  this repository for acceptance when upgrading the exact cohort.

## Browser measurement

Production UI with fixture APIs, 1440 × 1000, Lighthouse 13.5.0 desktop with
provided throttling. Both themes rendered actual superscripts/subscripts,
preserved all four table values and had no runtime console errors. Screenshots,
Lighthouse reports and traces are in the ignored `.tmp/issue-226/` directory.
These are fixture measurements, not live Core/OIDC acceptance.

| Theme | Accessibility | Best practices | CLS | LCP |
| --- | --- | --- | --- | --- |
| Light | 1.00 | 0.96 | 0.052109 | 1,246 ms |
| Dark | 1.00 | 0.96 | 0.052225 | 337 ms |

The measurements meet the existing accessibility floor (0.9) and CLS budget
(0.1). LCP is recorded as a local, runner-dependent measurement. Existing
stopped Core, Casdoor and deployed application services were not restarted.

## Release verification

- Public lint, formatting, typecheck, production builds and dependency audit
  at the existing production high-severity threshold passed.
- Public coverage: 103 files / 1,373 tests passed; statements 84.22%, branches
  75.33%, functions 87.36%, lines 85.48%.
- Full Chromium suite on a prewarmed dev server: 67 passed; the two existing
  opt-in live-web-tool cases remained skipped. Earlier cold development-server
  loads exceeded navigation deadlines; a request probe isolated startup loading,
  and the unchanged full suite passed after warming. No timeout was raised.
- All three packed `0.1.3` packages passed independent client declarations/API,
  Node runtime/auth/SQLite restart/resource cleanup and React reader/CSS/font
  checks, including the shared scientific fixture.
- Entry JS 268.1 KB, total JS 1,845.7 KB and CSS 27.0 KB gzip stayed within the
  unchanged 280 / 1,950 / 35 KB budgets.
- An isolated clone of private mbweb `0.1.8` installed the three candidate
  tarballs together. Lint, formatting, typecheck and 179 tests with coverage
  passed using one Windows worker. No delivered private manifest was changed.

Local test concurrency was reduced on Windows; coverage, bundle, timeout,
retry and assertion requirements are unchanged.
CI and npm trusted publishing reverify the clean merged commit and exact registry
tarball bytes before the downstream release notification.
