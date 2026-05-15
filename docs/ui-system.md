# dikw-web UI System

`dikw-web` is a read-only knowledge workbench. The UI should stay quiet,
compact, and inspection-focused: dense enough for repeated use, but not
styled like a generic admin dashboard.

## Shell

- Primary routes live in the sidebar.
- Settings is a separate sidebar footer item, not a primary knowledge
  route.
- Chat lives behind the canonical `#chat` route. Legacy `#query` links
  should redirect to `#chat`, but new UI and docs must use Chat/会话.
- Chat uses a three-zone workbench: the left history list scrolls
  independently, the center message list has its own conversation scroll,
  and the right rail shows session-level sources and tool calls. The
  composer stays fixed at the bottom of the Chat workspace.
- Chat context is session-scoped. The right rail keeps accumulated
  sources and tool calls for the open session instead of changing when a
  user clicks an assistant reply.
- Chat output panels use smart bottom-stick scrolling: the message list,
  Sources list, and Tool calls list default to the newest content while
  streaming, but a panel stops auto-following when the user scrolls that
  panel away from the bottom. Sending a new message resets all three
  panels to bottom-stick mode.
- Chat history actions live in each session row's compact `...` menu.
  Keep rename/delete there instead of adding destructive session actions
  to the context rail.
- Chat visual polish follows the PR6 patch language: active session rows
  use a 2px leading marker, assistant messages read as quiet article
  cards, user messages use a solid accent bubble, and the composer is one
  focused input surface with icon actions.
- Graph View includes an always-visible legend for Wiki and Source node
  colors. The graph canvas owns visual layout; core/API data should remain
  layout-free. Graph does not expose layer-scope toggles or force
  parameter sliders; those choices are product defaults.
- The top bar is a read-only connection status strip. It shows the
  target server and whether a token is configured, but never displays
  the token value.
- Server URL and token editing only happens in Settings. The default
  visible Server URL is `http://127.0.0.1:8765`; same-origin proxy
  wording should not appear in the shell chrome. The default browser
  requests may still use the Vite `/v1` proxy internally to avoid CORS.

## Preferences

- Locale is stored in `localStorage` under `dikw-web.locale`.
- Supported locales are `en` and `zh-CN`; the default is `en`.
- Navigation, page headers, toolbars, tabs, empty states, and primary
  page actions should render in the current locale only. Do not show
  bilingual chrome such as `Overview / 工作台概览`.
- Core data is not translated by the web layer. Markdown bodies, task
  results, raw JSON, provider names, model names, paths, and user content
  should be rendered as returned by `/v1`.
- Theme preference is stored in `localStorage` under `dikw-web.theme`.
- Supported theme preferences are `system`, `light`, and `dark`; the
  default is `system`.
- The resolved theme is applied as `html[data-theme="light|dark"]`.

## Visual Tokens

Use CSS variables for page background, surfaces, text, muted text,
lines, accent, status colors, and shadows. New UI should consume tokens
instead of hard-coded colors so light and dark modes stay aligned.

The current `src/styles.css` is the baseline UI specification for future
iterations. Keep the warm-stone neutral palette, petrol accent,
hairline borders, restrained shadows, grouped sidebar, breadcrumb
topbar, compact metric grid, and left-marker selected states unless a
future design explicitly replaces the system. Avoid one-off page colors,
heavy card shadows, oversized radii, and decorative gradients.

The Wiki reader has reader-specific tokens for article surfaces, text,
links, borders, quote blocks, code, and tables. Dark mode must keep the
middle reading pane as a low-glare dark surface; it must not introduce
large near-white reader controls or article blocks. Browser E2E checks
lock the reader contract with contrast thresholds: normal article text
at least 4.5:1, large headings at least 3:1, and metadata/control text
at least 3:1.

Markdown rendering supports pipe tables, a sanitized raw HTML table
subset, safe `<details><summary>...</summary>...</details>` blocks,
Mermaid fenced code, and KaTeX math. The raw HTML allow-list is
intentionally narrow: `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`,
`td`, `caption`, `colgroup`, `col`, and `br` for tables, plus
`details`/`summary` as a structured disclosure wrapper. Event
attributes, scripts, styles, and other non-table HTML must not become
live DOM.

Inline `$...$` and block `$$...$$` formulas render through KaTeX; parse
failures fall back to the original formula text. Fenced `mermaid` code
blocks render asynchronously with Mermaid using `securityLevel:
"strict"` and `htmlLabels: false`; render failures keep a readable code
fallback. Image asset loading is outside the current reader contract and
should be handled by a later asset/proxy slice.

Cards and controls should keep radii at 8px or less. Shadows should be
subtle and used to separate work areas, not decorate the page.

## Graph Canvas

Graph uses PixiJS as a rendering detail inside the existing workbench
surface. It should not become a separate black-space product mode. Use
the same warm neutral background, petrol wiki nodes, muted source nodes,
hairline borders, and small control radii as the rest of the app.

Bloom is reserved for node halos and path emphasis. Keep it soft enough
that labels, edges, and node hit targets remain readable in both light
and dark themes. Cluster nebulae should be low-alpha context, not
decorative blobs.

When the graph is large, the default view should behave like an
overview, not a literal full-detail diagram. Use small nodes, faint idle
edges, very soft nebulae, and sparse labels. The detail panel, hover,
focus, and path mode are where stronger edges, halos, and labels belong.

The canvas must keep an accessible DOM overlay for graph nodes. Pixi may
own pixels and camera interaction, but tests and keyboard users still
need stable `button` targets for selecting nodes and opening details.

## Components

Prefer shared local patterns over new dependencies:

- `panel` for framed work areas.
- `segmented-control` for mutually exclusive view choices.
- `status-pill` for statuses and auth/token posture.
- `field` for labeled form inputs.
- `icon-button`, `primary-button`, and `secondary-button` for actions.

Do not add shadcn, Radix, Tailwind, or another UI framework unless a
future plan explicitly changes that constraint.

## Mobile

At mobile widths the sidebar becomes a horizontal app rail and Settings
stays at the end. Connection settings stay off the top bar so the first
viewport remains focused on page content.
