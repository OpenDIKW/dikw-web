# @opendikw/web-ui

Shared React 19 controls, sanitized Markdown and bilingual readers, hooks,
auth context and application-owned theme preferences. Node 24 or newer is required
for the build toolchain. React and react-dom are peers supplied by the application;
the compiled package preserves external imports and a single AuthContext.

```tsx
import { Button } from "@opendikw/web-ui/controls";
import { MarkdownView } from "@opendikw/web-ui/reader";
import { AuthContext, useCanEdit } from "@opendikw/web-ui/auth";
import { useTheme } from "@opendikw/web-ui/theme";
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
import "@opendikw/web-ui/reader.css";
```

Use `/hooks` for async loading and bilingual/preview translation. `/controls`
does not load Mermaid, ECharts or a Node runtime. `/reader` lazily loads diagram
and chart engines and uses KaTeX CSS/fonts through the application's bundler.
Callers provide their own labels, routes and API connection. The package has no
workbench translations or MB business models.

The reader accepts attribute-free `<sup>` and `<sub>` pairs (case-insensitive)
on one line, containing text or inline Markdown. Attributes, nested raw HTML and
unbalanced pairs remain escaped; code spans and fences retain literal tags.
Raw HTML tables also retain `sup`, `sub`, `i`, `em`, `b` and `strong` with all
their attributes stripped. Other elements are unwrapped after sanitizing their
children so scientific values and labels survive as inert text. Heading outlines
and anchors omit accepted tags while retaining their content. Existing imported
sources require no reconversion. The repository's
`tests/fixtures/scientific-markdown.json` is shared by regression, workbench e2e
and independent packed/registry consumer checks and can be reused downstream.

Cohort `0.1.4` uses the shared forward details scanner and built-in chart row
trimming so malformed blocks and long whitespace do not trigger polynomial
regular-expression backtracking. Safe details, scientific markup, chart data
and heading anchors retain their existing behavior.

`useTheme({ storageKey })` returns `preference`, `resolved` and `setPreference`.
It applies the resolved theme, follows OS changes for `system`, and persists an
explicit selection to that application's key. Mounting does not overwrite a
stored system preference. `loadAuth` preserves optional public issuer/coreId
metadata alongside the existing enabled/user/role response.

Authenticated applications must mount `AuthContext.Provider` with the result
of `loadAuth`. `useCanEdit` controls presentation; the server must enforce
authorization on every request. Without a provider, the context defaults to
the existing auth-off development mode.

Credentialed readers must receive a trusted Core asset base URL and its matching
token. Asset configuration is supplied by the application and must not come
from untrusted document metadata; the reader does not enforce an origin policy
on that configuration.

Build explicitly with `npm run build:packages`; CSS is copied explicitly because
install scripts are disabled. npm publishes compiled ESM, declarations, styles,
README and the MIT license. Use public exports rather than source deep imports.

Source provenance: extracted from OpenDIKW/dikw-web at
`f245ec43520017f961fcea629a5c4fac97f01862`; original history and authors remain
in that repository. App shells, GraphCanvas and application layouts stay outside
the package.
