# Graph View

Graph View is a read-only knowledge map for `dikw-web`. It is inspired
by Obsidian Global Graph: notes become nodes, internal links become
edges, and clicking a node focuses its one-hop neighborhood. It does not
copy Obsidian behavior wholesale and does not modify base content.

## V1 Behavior

- Route: `#graph`.
- Default scope: `wiki`.
- Alternate scopes: `source` and `all`.
- Data source: `GET /v1/base/graph?active=true`.
- Rendering: React SVG with a d3-force layout.
- Navigation: the detail panel button `Open in Knowledge` switches to
  `#wiki` and passes the selected path directly to `WikiPage`.

`dikw-core` returns the complete active graph in one request:
`base_revision`, `generated_at`, `nodes[]`, `edges[]`, `unresolved[]`,
and `stats`. The endpoint deliberately does not support a `layer`
parameter. `dikw-web` always requests the full active graph and applies
the `wiki`, `source`, and `all` scopes client-side by filtering nodes,
then keeping only edges whose endpoints remain visible.

## Core Graph Contract

Nodes use `id`, `path`, `title`, `layer`, `active`, `mtime`, `inbound`,
and `outbound`. The web render model computes `linkCount` as
`inbound + outbound` and uses it for node radius and orphan filtering.

Edges use `source`, `target`, `target_text`, `anchor`, and `weight`.
Repeated identical links are already aggregated by core, so the web
preserves `weight` for link thickness.

Unresolved links use `source`, `target_text`, `anchor`, and `count`.
They are shown in stats and node detail, but v1 intentionally avoids
ghost nodes. Filtered unresolved totals sum `count`, not entry count.

`base_revision` is the cache key for future optimization. The current
implementation refetches on refresh; it does not yet skip layout work
when the revision is unchanged.

## Interaction Model

- Search filters by node title or path.
- Hide orphans removes nodes whose inbound plus outbound count is zero.
- Clicking a node focuses that node and its one-hop neighbors.
- Non-neighbor nodes and unrelated edges are muted, not removed.
- Zoom and force controls tune the current client-side layout only.

## Test Boundary

Tests lock the behavior at three layers:

- `src/utils/graph.test.ts`: core graph adaptation, filtering,
  unresolved count accounting, and bounded layout output.
- Page/App tests: `/v1/base/graph?active=true`, SVG nodes/links,
  scope filtering, focus/detail, and open-in-Wiki behavior.
- Playwright smoke: graph route, stats, node detail, absence of
  `/v1/base/pages/{path}` graph body reads, and Wiki navigation.
