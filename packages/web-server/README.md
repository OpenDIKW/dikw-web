# @opendikw/web-server

Shared Node 24 BFF runtime for DIKW applications. MIT licensed; application
business code, branding, configuration and static output stay in their own
repositories. Native SQLite dependencies remain external at runtime.

```ts
import { createServer } from "node:http";
import { registerOutboundInstrumentation } from "@opendikw/web-server/instrumentation";
import { createWebRuntime } from "@opendikw/web-server/runtime";

registerOutboundInstrumentation();
const runtime = await createWebRuntime({
  appId: "dikw-mbweb",
  profile: "mbweb",
  cwd: process.cwd(),
  staticDir: "dist",
  env: process.env,
});
const server = createServer((req, res) => void runtime.handler(req, res));
server.listen(4321);
// The application owns listening and signal hooks. Drain runtime resources
// alongside server.close() during shutdown.
```

`createWebRuntime` returns an HTTP `handler` and idempotent async `close`.
`createLogger(scope, appId?)` provides the existing structured/redacted startup
logger for thin application entries without importing private package paths.
Since cohort `0.1.5` it records an `Error` field as its name plus a constant-shaped
code (`Error [EADDRINUSE]`), never its message, on stdout and in OTel log records.
Importing the package does not listen, install signal hooks, read application
static files or initialize a database. Factory creation validates configuration,
the static build and SQLite, then owns auth sessions, agent sessions and Web jobs.
Closing rejects new requests, aborts agent/jobs, drains work and closes databases.
The ADK schema and existing HTTP/NDJSON shapes are preserved.

Use `/vite` and `createApplicationPlugins({ appId, profile })` in development.
Vite 8 is an optional peer, isolated from the production `/runtime` dependency
graph. The profile guard runs before Vite's Core proxy and both sidecars.
Development sidecars retain the existing auth-off behavior; use standalone
runtime for OIDC validation. Expose an auth-off development server only locally.

`workbench` preserves existing routes and role rules. `mbweb` allows the current
paper/read/retrieve, upload/ingest/synth, Wisdom, session, conversion and
translation workflows. It denies unknown APIs, maintenance operations, task
listing/cancellation, proposals and traces. The application fixes the profile;
requests cannot select it. `isRequestAllowed` exposes the same policy for tests.

Both apps can share a Core knowledge base. This does not provide per-user Core
content isolation. Each BFF needs its own session directory, secret and OIDC
client configuration. Workbench retains `dikw_session`/`dikw_login`; MB uses
`dikw_mbweb_session`/`dikw_mbweb_login`, all host-only. Agent app names and Web job
stores are separate. The #204 user job isolation and #205 sliding renewal,
role sync and absolute session cap remain shared behavior.

Existing `DIKW_WEB_*`, `DIKW_AGENT_*`, `DIKW_CORE_URL` and `DIKW_SERVER_TOKEN`
variables are loaded from the application's `.env.local`, overridden by `env`.
Production MB requires OIDC and a stable, non-secret `DIKW_WEB_CORE_ID`.
Authenticated MB `/web/auth/me` adds public `issuer`/`coreId`; it never exposes
the server's Core URL or token. Workbench responses retain their old fields.
Agent tools always use the server connection in auth mode. MB registers no
maintenance tool; external search/fetch tools require their configured keys.

Request logs carry the application ID; telemetry defaults to its service name,
with the standard `OTEL_SERVICE_NAME` override. ADK/OTel providers are process
global: deploy each app in its own process, as intended by the BFF topology.

Build explicitly with `npm run build:packages` before packing. No installation
scripts are needed. Published files contain compiled ESM, declarations, this
README and the MIT license; test IdP fixtures and application code are excluded.
Source provenance: OpenDIKW/dikw-web commit
`162e619d6052d43b8fdc77048b23a60a7b2d4b02`; history/authors remain there.

Optional page-scoped Agent sessions bind a canonical Markdown page path at
creation and persist it in SQLite. Scoped turns allow only health and reading
that exact page; they expose no global retrieval, listing or external tools.
The message body cannot change the session scope. Unscoped sessions preserve the
existing tool set. Page evidence produces the existing source citation event.
