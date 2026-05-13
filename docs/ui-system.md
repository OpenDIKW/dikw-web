# dikw-web UI System

`dikw-web` is a read-only knowledge workbench. The UI should stay quiet,
compact, and inspection-focused: dense enough for repeated use, but not
styled like a generic admin dashboard.

## Shell

- Primary routes live in the sidebar.
- Settings is a separate sidebar footer item, not a primary knowledge
  route.
- Agent Chat lives behind the existing `#query` route for compatibility,
  but the visible product concept is Agent-driven conversation rather
  than a raw query form.
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

Cards and controls should keep radii at 8px or less. Shadows should be
subtle and used to separate work areas, not decorate the page.

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
