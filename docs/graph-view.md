# Graph View

Graph View is a read-only knowledge map for `dikw-web`. It is inspired
by Obsidian Global Graph: notes become nodes, internal links become
edges, and clicking a node focuses its one-hop neighborhood. It does not
copy Obsidian behavior wholesale and does not modify base content.

## V1 Behavior

- Route: `#graph`.
- Scope: complete active graph returned by core. The page no longer
  exposes a `wiki` / `source` / `all` toggle.
- Data source: `GET /v1/base/graph?active=true`.
- Rendering: PixiJS canvas with a deterministic clustered layout and
  accessible DOM node hit targets.
- Navigation: the detail panel button `Open in Base` switches to
  `#base` and passes the selected path directly to `WikiPage`.

`dikw-core` returns the complete active graph in one request:
`base_revision`, `generated_at`, `nodes[]`, `edges[]`, `unresolved[]`,
and `stats`. The endpoint deliberately does not support a `layer`
parameter. `dikw-web` always requests and displays the full active
graph. Search and hide-orphans are still client-side filters, then edges
are kept only when both endpoints remain visible.

## Core Graph Contract

Nodes use `id`, `path`, `title`, `layer`, `active`, `mtime`, `inbound`,
and `outbound`. The web render model computes `linkCount` as
`inbound + outbound` and uses it for node radius, orphan filtering,
cluster summaries, and label priority.

Edges use `source`, `target`, `target_text`, `anchor`, and `weight`.
Repeated identical links are already aggregated by core, so the web
preserves `weight` for link thickness.

Unresolved links use `source`, `target_text`, `anchor`, and `count`.
They are shown in stats and node detail, but v1 intentionally avoids
ghost nodes. Filtered unresolved totals sum `count`, not entry count.

`base_revision` is the cache key for future optimization. The current
implementation refetches on refresh; it does not yet skip layout work
when the revision is unchanged.

## Pixi Canvas

The canvas uses a web-only render model derived from `KnowledgeGraph`:

- Louvain-inspired deterministic community detection groups related
  pages into visual clusters. If clustering degenerates into too many
  tiny communities, or if a large graph collapses into too few giant
  communities, the renderer falls back to `layer + path segment` groups.
- Large graphs use an overview profile: compact node radii, thinner
  edges, sunflower-style cluster placement, and no cross-cluster edge
  attraction during layout. Cross-cluster edges remain visible as
  relationships, but they do not pull every community into one central
  hairball.
- Cluster nebulae, edges, node bodies, and labels are drawn as separate
  Pixi layers. The graph intentionally does not ship Bloom or node halo
  effects; focus emphasis uses stroke weight, opacity, and color
  so large graphs stay cheaper to render.
- DOM hit buttons are positioned over the canvas for keyboard access,
  Testing Library queries, and Playwright clicks.

## Interaction Model

- Search filters by node title or path.
- Hide orphans removes nodes whose inbound plus outbound count is zero.
- Clicking a node focuses that node and its one-hop neighbors.
- Non-neighbor nodes and unrelated edges are muted, not removed.
- Pan and wheel zoom are handled inside the Pixi canvas. Layout and
  visual parameters are fixed defaults; the page no longer exposes
  force sliders.

## Test Boundary

Tests lock the behavior at three layers:

- `src/utils/graph.test.ts`: core graph adaptation, filtering,
  unresolved count accounting, galaxy graph derivation, and
  deterministic layout output.
- Page/App tests: `/v1/base/graph?active=true`, absence of scope and
  force controls, complete graph visibility, focus/detail,
  and open-in-Wiki behavior.
- Playwright smoke: graph route, stats, Pixi canvas, node
  detail, absence of `/v1/base/pages/{path}` graph body reads, and Wiki
  navigation.
