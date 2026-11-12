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
Since cohort `0.1.5` it records an `Error` field as its class name plus a known
system or transport code (`TypeError [ECONNREFUSED]`), never its message, on stdout
and in OTel log records; any other object value logs as `[object]`. Log a reason
string yourself only where no provider error can reach it, such as startup config.
A handler error that escapes a SERVER span is recorded the same way: the status
message is `Class [CODE]` and `exception.type` the known code, else the class; its
message and stack are not exported.
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

### External OIDC base path

For a same-origin application mounted below a path, pass the trusted server-only
`publicBasePath` option, for example
`createWebRuntime({ publicBasePath: "/knowledge-base", ... })`. It prefixes only
the OIDC authorization `redirect_uri`, the callback URL used for the token grant,
and the RP-initiated logout `post_logout_redirect_uri`. Keep
`DIKW_WEB_PUBLIC_URL` as the bare public origin; unsafe requests still require
that exact Origin. The runtime does not read a base path from forwarded headers.

Omitting the option, `""`, and `"/"` preserve root behavior. Other values must be
canonical absolute paths made of lowercase letters, digits, hyphens and slash
separated segments, without a trailing slash. Nested paths are supported; query,
hash, percent encoding, dot segments, repeated separators and backslashes are not.

This option is not a router mount. The application must validate its external
mount and remove the prefix before calling `handler`, `withModelIdentity`, or
`resolveModelFor`. Those methods continue to accept root-relative internal
paths such as `/web/auth/me`, `/agent/sessions`, and `/v1/retrieve`, so an
application can compose its own business routes around the runtime. The outer
application adapter remains responsible for its cookie Path, same-origin
Location headers, login return destinations, auth-page HTML links/scripts and
matching CSP hashes, as well as the frontend's built asset/API paths. None of
these responses are rewritten by `publicBasePath`.

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

### Request-scoped model integration

`createWebRuntime({ resolveModel, validateSession, ... })` accepts a trusted,
server-only `ModelResolver`. It requires OIDC plus live session validation.
The resolver receives the gate-verified identity and original request, and returns
`{ model, complete(body, signal, identity) }`. `body` and the result use non-streaming
OpenAI chat-completion shapes. The integration chooses an approved fixed service
URL and supplies credentials only inside its closure. Never return identity or
credentials to a browser, logs, traces, model prompts, or persisted job/session state.
Only a model profile identifier may come from a browser; the backend owns selection
and authorization. `ModelResolutionError(status, safeMessage)` carries deliberate,
credential-free failures; unrecognized exceptions are replaced with a generic error.

The runtime wraps every completion, including tool continuation, compaction,
translation batches, and repair calls. It rechecks the original local session and
runs its existing refresh/live-authorization chain before the model call. The
**third `identity` argument is the fresh verified identity**; transports must use
its access token rather than retaining the resolver's initial token. The wrapper
ignores third-argument identities supplied by callers. Ordinary token refresh can
continue under the same session, issuer, subject and original login timestamp.
Logout, a replaced login, password change or revoked access stop the next call.
A model choice is resolved once for each submitted task/turn and stays fixed.
Model resolution receives a signal combining caller cancellation and runtime
shutdown, so a cancellation-aware pending resolver cannot hold shutdown open.
Delegated completions also receive this combined signal, and recheck it after
live identity validation, before starting the transport.

Hook mode does not require or fall back to `DIKW_AGENT_API_KEY`, `_BASE_URL`, or
`_MODEL`. Tool service credentials and compaction settings retain their existing
configuration. Agent ownership, tools, NDJSON output and history storage are
unchanged. Reasoning returned with tool calls is retained as ADK `thought` parts
for the next provider call and omitted from visible text/history. The OpenAI
adapter rejects a completion containing only hidden reasoning without a visible
answer or tool calls, including when the output budget is exhausted. The OpenAI
adapter shares the existing eight-call and 8192-output-token agent budgets with
compaction. Translation retains its block parsing, alignment, repair, cancellation
and detached job contracts; its configured output cap defaults to 64000.

Application-owned AI routes can use optional
`runtime.resolveModelFor(req, res, 'knowledge', signal)`; a `null` return means the
auth gate already rejected the request. They still enforce their own document and
write permissions. `runtime.withModelIdentity(req, res, callback)` supports safe
catalog requests without resolving a model; the callback must return only public
metadata. Both helpers exist only in hook mode. Existing applications that omit
`resolveModel` keep their configured MiniMax transport and authentication behavior.

Translation submissions cancelled while model selection is pending do not create
background jobs. A successful 202 response still hands ownership to the background
job, so a later poll disconnect does not cancel it. Model-selection failures retain
their safe HTTP status, and clients can distinguish `translator_forbidden`,
`translator_settings_changed` and `translator_unavailable` without receiving
provider credentials or raw upstream error text.
Transient 502/503 and normalized transport failures use the existing bounded
translation retries. Authentication, permissions, changed settings, unavailable
models, rate limits and cancellation remain terminal for a submitted task.
Known fetch/SDK cancellation errors keep a server-only nonretryable hint through
safe error normalization; their original messages are discarded. Connection and
SDK timeout failures still normalize to a transient 503 and use the bounded retry
policy. The hint does not add fields to public HTTP or NDJSON errors.
An output-budget truncation is terminal before content parsing, including a
reasoning response with null or empty visible content; it never triggers a retry.
