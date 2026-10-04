# @opendikw/web-client

MIT-licensed Core and Agent clients extracted from the OpenDIKW workbench.
Node 24 or newer is required. Import the documented subpath matching your use:

```ts
import { DikwClient } from "@opendikw/web-client/core";
import { AgentClient } from "@opendikw/web-client/agent";
import type { AuthState, PageReadResult } from "@opendikw/web-client/types";

const core = new DikwClient({ baseUrl: "https://core.example", token: "server-token" });
const health = await core.get("/v1/health");
```

`/core`, `/agent`, and `/types` have no browser globals at module initialization.
Browser operations are provided by `/import` (archive and asset helpers),
`/convert` (conversion and cache), `/translate` (translation and cache),
`/document` (Markdown parsing, references and formatting), and `/connection`
(the default development Core URL). They do not own application routes or storage keys.

Conversion and translation caches accept `{ namespace }`. Omit it to retain
the existing cache database names and TTL. Applications may use an identity
and Core-specific namespace to keep local caches separate.

Build explicitly with `npm run build:packages` from the repository root;
install scripts are disabled. npm packages contain compiled ESM and declarations,
this README and the MIT license. Import through `exports`, not package source paths.

Source provenance: extracted from OpenDIKW/dikw-web at
`c924b157747f737be56f8c3361068d3d543c86e9`; original commit history and authors
remain in that repository.

For document Q&A, createSession(signal, { pagePath: "sources/paper.md" }) binds an
immutable evidence scope to the session. Omit the second argument for existing
whole-base conversations. Session.scope exposes the server-confirmed path.
