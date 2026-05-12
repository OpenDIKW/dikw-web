# dikw-web UI System

`dikw-web` is a read-only knowledge workbench. The UI should stay quiet,
compact, and inspection-focused: dense enough for repeated use, but not
styled like a generic admin dashboard.

## Shell

- Primary routes live in the sidebar.
- Settings is a separate sidebar footer item, not a primary knowledge
  route.
- The top bar is a read-only connection status strip. It shows the
  target server and whether a token is configured, but never displays
  the token value.
- Server URL and token editing only happens in Settings.

## Preferences

- Locale is stored in `localStorage` under `dikw-web.locale`.
- Supported locales are `en` and `zh-CN`; the default is `en`.
- Theme preference is stored in `localStorage` under `dikw-web.theme`.
- Supported theme preferences are `system`, `light`, and `dark`; the
  default is `system`.
- The resolved theme is applied as `html[data-theme="light|dark"]`.

## Visual Tokens

Use CSS variables for page background, surfaces, text, muted text,
lines, accent, status colors, and shadows. New UI should consume tokens
instead of hard-coded colors so light and dark modes stay aligned.

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
