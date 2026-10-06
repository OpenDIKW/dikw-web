---
paths:
  - "packages/web-ui/src/reader/**"
  - "packages/web-client/src/document/**"
  - "src/pages/{WikiPage,WisdomPage}.tsx"
  - "docs/adr/0002-source-inline-references.md"
---

# Markdown reader (`packages/web-ui/src/reader/MarkdownView.tsx`)

Read this rule before you change Markdown rendering, images, charts, or source inline references.

Pipe tables, a sanitized raw HTML table subset, safe `details/summary`, KaTeX math, Mermaid fenced code, standard CommonMark image embeds (`![alt](path)`) and Obsidian-style image embeds (`![[path]]`), and chart blocks (`<details><summary>bar|line|scatter|heatmap</summary>` wrapping a pipe table). Attribute-free single-line `sup/sub` pairs accept text and inline Markdown; table cells retain `sup/sub/i/em/b/strong` without attributes and unwrap unsupported elements without losing text. Accepted scientific tags are omitted from heading outline text and ids. Code remains literal. Arbitrary raw HTML, scripts, event attributes, and inline styles must not become live DOM.

Both image syntaxes resolve through `PageReadResult.assets[]` (matching `original_paths` or the SHA-256 segment of the filename) and load from `GET /v1/assets/{asset_id}` via the Settings-owned base URL. The standard-syntax renderer additionally retries lookup with `decodeURIComponent` because markdown-it normalizeLink percent-encodes non-ASCII paths (e.g. `./封面.png`) while core stores `original_paths` raw. When a session token is configured, images are hydrated through an authenticated `fetch` + `URL.createObjectURL` instead of a plain `<img src>` so the `Authorization` header is honored; missing assets render a `.md-broken-image` placeholder, except empty `![]()` which collapses to nothing. Remote URLs (`http(s)://`, `data:`) pass through verbatim with the `markdown-image` class for consistent styling.

Charts use Apache ECharts, lazy-imported per-module for tree-shaking. The placeholder element carries the parsed spec as a base64-encoded `data-chart-spec`; if ECharts fails to load or a single chart fails to render, the placeholder falls back to a `<details>` block containing the source pipe table so data is never lost. Dark mode passes the `"dark"` theme to `echarts.init`.

Before it renders, the Source-layer Read tab runs `injectInlineRefs` (`packages/web-client/src/document/source-inline-refs.ts`).
For each K page that has a back-edge to the source, it turns the first occurrence of that page's title in the body into a `[[title|literal]]` wikilink.
K pages that do not match stay in the Linked references panel at the bottom. The Source tab always shows the raw `page.body`.
Design details: `docs/adr/0002-source-inline-references.md`.
