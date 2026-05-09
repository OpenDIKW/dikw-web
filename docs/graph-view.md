# Graph View

Graph View is a read-only knowledge map for `dikw-web`. It is inspired
by Obsidian Global Graph: notes become nodes, internal wikilinks become
edges, and clicking a node focuses its one-hop neighborhood. It does not
copy Obsidian behavior wholesale and does not modify base content.

## V1 Behavior

- Route: `#graph`.
- Default scope: `wiki`.
- Alternate scopes: `source` and `all`.
- Data source: existing Base Pages API only.
- Rendering: React SVG with a d3-force layout.
- Navigation: the detail panel button `在知识库打开` switches to `#wiki`
  and passes the selected path directly to `WikiPage`.

The page loads active page records from `GET /v1/base/pages?active=true`,
then reads page bodies through `GET /v1/base/pages/{path}` for the
selected scope. Body reads are capped at 8 concurrent requests so large
knowledge bases do not start hundreds of fetches at once.

## Wikilink Resolution

The parser supports:

- `[[Target]]`
- `[[Target|alias]]`
- `[[Target#anchor]]`

Targets resolve against title, path, basename, slug-like whitespace
normalization, and unique token matches. Resolved links create directed
edges. Duplicate links between the same source and target become one
edge with higher weight. Unresolved links remain visible in counts and
node detail, but v1 intentionally avoids ghost nodes.

## Interaction Model

- Search filters by node title or path.
- Hide orphans removes nodes whose inbound plus outbound count is zero.
- Clicking a node focuses that node and its one-hop neighbors.
- Non-neighbor nodes and unrelated edges are muted, not removed.
- Zoom and force controls tune the current client-side layout only.

## Test Boundary

Tests lock the behavior at three layers:

- `src/utils/graph.test.ts`: graph building, filtering, unresolved link
  accounting, and bounded layout output.
- Page/App tests: API calls, SVG nodes/links, focus/detail, and
  open-in-Wiki behavior.
- Playwright smoke: graph route, stats, node detail, and Wiki navigation.

## Future Core Endpoint

If `dikw-core` later exposes `/v1/base/graph`, the web page can switch
the graph builder behind the same tests. Migration should keep the
visible contract stable: nodes, edges, unresolved counts, filtering,
focus, and open-in-Wiki must continue to pass before removing the
client-side builder.
