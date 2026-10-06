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

`convertSource(file)` normalizes long upload names itself and preserves the true
name in provenance. `DikwClient.importBundle` checks active/inactive indexed source
paths before posting. Packages that would replace a source or an active source's
referenced attachment are returned in `rejected` with `source_path_exists` or
`source_asset_exists`; safe packages keep their original manifest ids. A wholly
rejected preflight makes no import POST and returns empty `import_id`/`applied_at`,
zero uploaded bytes and `committed: []`. Always inspect `rejected` and optional
`warnings` (including `source_content_matches`); matching bodies may have different
metadata/assets. Skip ingest/synth when `committed` is empty.

If an active source uses a local absolute attachment reference, the HTTP client
cannot determine its filesystem target. It conservatively rejects incoming
packages with attachments as `source_asset_scope_unknown`, with the existing
source path and original reference in `detail`; Markdown-only packages can still
commit. Change that source's attachment reference to a relative path before
retrying. This may reject an unrelated attachment rather than risk replacing data.

This preflight uses Core's index. It cannot reserve paths atomically or see
unindexed files; inactive source names are protected, but their bodies cannot be
read to discover attachment references. Core remains responsible for concurrent
write protection. Optional warning inspection preserves non-conflicting Core tar
formats unchanged; if a conflicting archive cannot be safely filtered by the
shared USTAR reader, the remainder is rejected as `unsupported_safe_import_archive`.

Build explicitly with `npm run build:packages` from the repository root;
install scripts are disabled. npm packages contain compiled ESM and declarations,
this README and the MIT license. Import through `exports`, not package source paths.

Source provenance: extracted from OpenDIKW/dikw-web at
`c924b157747f737be56f8c3361068d3d543c86e9`; original commit history and authors
remain in that repository.

For document Q&A, createSession(signal, { pagePath: "sources/paper.md" }) binds an
immutable evidence scope to the session. Omit the second argument for existing
whole-base conversations. Session.scope exposes the server-confirmed path.
