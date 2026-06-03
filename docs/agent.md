# Agent Sidecar (Google ADK)

`dikw-web` runs the chat agent on **Google ADK** (`@google/adk`) in a Node
sidecar and exposes same-origin `/agent/*` routes to the browser. The
browser never receives LLM keys; it only streams Agent events and reads
persisted session metadata. The `/agent/*` HTTP API and the
`AgentStreamEvent` NDJSON wire shape are unchanged from the previous
runtime — the chat UI is unaffected by the migration off Pi Agent.

The same sidecar process also serves `/web/*` for non-agent browser
helpers (see `server/web/` — currently the mineru-backed PDF / Office
converter consumed by ImportPage). Those routes do not call the agent and
do not touch `dikw-core`; they exist purely so the browser can offload
external-API calls that would otherwise hit CORS or expose vendor keys.
Keep new browser-helper endpoints under `/web/*`, not under `/agent/*`.

## Runtime

The runtime lives in `server/agent/` and is wired together by
`createDefaultAgentHandler` (`http.ts`):

- **`MiniMaxLlm`** (`minimaxLlm.ts`) — a custom `extends BaseLlm` adapter
  for MiniMax via its **Anthropic-compatible** Messages API. It uses the
  official `@anthropic-ai/sdk` as transport and translates deterministically
  between ADK/genai shapes (`LlmRequest`/`LlmResponse`, genai
  `Content`/`Part`) and Anthropic message shapes. Auth is `x-api-key` (the
  SDK default); no Bearer token and no proxy are needed against
  `https://api.minimaxi.com/anthropic`. The model is `MiniMax-M3`. MiniMax
  `thinking` content blocks are intentionally dropped — only `text` and
  `tool_use` cross the boundary.
- **`AdkAgentRunner`** (`adkRunner.ts`) — drives one chat turn on ADK's
  `Runner` (SSE streaming mode) and maps each ADK `Event` to zero or more
  `AgentStreamEvent`s via the pure, exported `mapAdkEvent`: PARTIAL text →
  `message_delta`; `functionCall` → a `running` `tool_event`;
  `functionResponse` → a `succeeded`/`failed` `tool_event`, then any
  `source`s, then a `proposal` (reusing `sourcesFromTool` / `proposalFromTool`
  from `runtime.ts`). The Runner auto-appends the user message and persists
  non-partial events, so the runner never persists manually.
- **`AdkSessionStore`** (`adkSessionStore.ts`) — wraps ADK's
  `DatabaseSessionService` and projects ADK events into the existing
  `AgentSession` DTO shape at **read time**, so the chat UI sees
  byte-identical session data regardless of the underlying store. Listing
  fields (`title`, `createdAt`, `messageCount`, `lastMessagePreview`) and
  proposal status are mirrored into `session.state` because `listSessions`
  returns sessions with empty events but populated state.
- **Tools** — `createDikwTools` (`adkTools.ts`) returns ADK `FunctionTool`s
  that reuse the existing `CoreToolClient` / `WebToolClient` from `tools.ts`.

## OpenTelemetry / #trace

ADK emits OpenTelemetry spans for every invocation. `initAgentTelemetry`
(`telemetry.ts`) registers a `DikwSpanProcessor` (`dikwSpanProcessor.ts`)
via ADK's `maybeSetOtelProviders` — once per process, since the provider is
process-global and idempotent. The processor projects each finished span
into a flat `SpanRow` in an in-memory `SpanStore` (`spanStore.ts`, bounded,
FIFO-evicted at 5000 rows), resolving the session id from
`gcp.vertex.agent.session_id` / `gen_ai.conversation.id` and the invocation
id from `gcp.vertex.agent.invocation_id`.

The hidden `#trace` page (URL-only, not in the sidebar) reads
`GET /agent/sessions/{id}/traces`, which calls `SpanStore.getSessionTraces`
to re-assemble the rows into a per-session waterfall (`SessionTraceView` →
invocations → spans). **Spans are ephemeral** — they are lost on a sidecar
restart by design; only the conversation content is persisted (in sqlite).

## Configuration

Local credentials live in `.env.agent.local`, which is ignored by Git
through `*.local`. Use `.env.agent.example` as the template:

```dotenv
DIKW_AGENT_PROVIDER=minimax
DIKW_AGENT_API=anthropic-messages
DIKW_AGENT_API_KEY=<MiniMax key>
DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic
DIKW_AGENT_MODEL=MiniMax-M3
```

The current MiniMax key can be copied from `../dikw-core/.env`
`ANTHROPIC_API_KEY`, because the core configuration uses MiniMax through
an Anthropic-compatible endpoint.

`DIKW_AGENT_TAVILY_API_KEY`, `DIKW_AGENT_JINA_API_KEY`, and
`DIKW_AGENT_BRAVE_API_KEY` are optional. The active web backends are
Tavily for `web_search` (no proxy required) and Jina Reader for
`web_fetch`. `DIKW_AGENT_BRAVE_API_KEY` is loaded into `AgentConfig` but
not currently wired to any registered tool — the Brave client is
retained in `WebToolClient.search` for future provider rotation.

`MinerUAPIKey` (alias `DIKW_AGENT_MINERU_API_KEY`) is optional and is
read by `server/web/config.ts`, not by `AgentConfig` — mineru is a
browser-helper concern, not an agent tool. Missing key →
`POST /web/mineru/convert` returns `503 mineru_disabled` and ImportPage
degrades to `.md/.pdf` only. Variable name `MinerUAPIKey` matches the
`dikw-plugins/.env` convention so the same key file can be reused.

When a key is missing, `loadAgentConfig` still succeeds and the
corresponding tool throws a clear "requires `DIKW_AGENT_*`" error on
invocation, without echoing any configured value. Other tools are
unaffected.

Do not use `VITE_*` for these values. `VITE_*` variables are browser
visible.

The dikw-core URL is not read from `.env.agent.local`. The browser sends
the current Settings `Server URL` with each Agent message and maintenance
confirmation. If `coreUrl` is missing, `/agent/*` returns `400
invalid_request`.

## Session Storage

Sessions persist to **local SQLite** via ADK's `DatabaseSessionService`,
in `.agent-sessions/agent.sqlite` (appName `dikw-web`, userId `demo`). The
directory is ignored by Git and is local to the workstation; `http.ts`
creates the directory and hands the service a `sqlite://.../agent.sqlite`
URI (POSIX slashes — Windows backslashes break the URI parse). The legacy
one-JSON-file-per-session store is gone, and old `.agent-sessions/*.json`
files are **not** migrated (local demo data — expect a one-time reset).

ADK stores raw conversation events; `AdkSessionStore` projects them into
the `AgentSession` DTO at read time. The stored events and mirrored state
must not contain MiniMax or other LLM API keys, core bearer tokens, or
browser session-storage values.

Sources and tool call summaries are session-level context derived from the
stored `functionResponse` events. The Chat UI shows the accumulated context
for the open session instead of filtering it by assistant reply. This keeps
the right rail stable while users read or scroll through the conversation
history.

Each session has a `title`, mirrored into `session.state`. New sessions
start as `New chat`; the first user message auto-generates a title (in
`finalizeTurn`) only while the title is still the default. Users can rename
a chat from the web UI, and that manual title is persisted to state.

Reopening a historical session reconstructs context by projecting the
persisted ADK events — there is no in-memory agent object to rely on.

## Context compaction

A long conversation grows the prompt every turn (the full event history is
sent to MiniMax-M3, whose context window is **1,048,576** tokens). To keep the
prompt bounded, `AdkAgentRunner` attaches ADK's built-in
**`TokenBasedContextCompactor`** to the `LlmAgent` (`contextCompactors`). The
factory lives in `contextCompactor.ts` (`buildContextCompactor`) and the
summarizer is ADK's `LlmSummarizer`, reusing the agent's own `MiniMaxLlm`
instance.

When it fires, ADK summarizes the oldest events into a persisted
`CompactedEvent` and `ContentRequestProcessor` rebuilds the prompt as
`[summary, ...recent raw events]`, so the prompt actually shrinks. The
`CompactedEvent` is non-partial, so the Runner persists it to sqlite and the
compaction carries across turns. `mapAdkEvent` emits nothing for it (no live
wire event), and `AdkSessionStore.projectMessages` filters `isCompactedEvent`
so the summary never renders as a chat bubble. The extra summarization call
shows up as one additional `call_llm` span on the `#trace` page.

Configured via `.env.agent.local` (all optional, defaults shown):

```dotenv
DIKW_AGENT_COMPACTION_ENABLED=true      # set false/0 to disable
DIKW_AGENT_CONTEXT_WINDOW=1048576       # MiniMax-M3 window, in tokens
DIKW_AGENT_COMPACTION_RATIO=0.5         # trigger fraction of the window
DIKW_AGENT_COMPACTION_RETENTION=8       # min recent raw events kept verbatim
```

The trigger threshold is `round(contextWindow * ratio)` (524,288 at the
defaults). **Caveat:** ADK's `shouldCompact` *sums* each event's
`promptTokenCount`, and every model event's count already includes the full
prior history, so the threshold is an aggregate across the session, not the
live prompt size — effective compaction triggers somewhat *before* the live
context literally reaches `ratio` of the window (a conservative bias). Raise
`DIKW_AGENT_CONTEXT_WINDOW` / `DIKW_AGENT_COMPACTION_RATIO` to compact later. A
summarization failure is swallowed (logged) and the turn proceeds with the
un-compacted history — compaction is an optimization, not a correctness
requirement.

## API

- `GET /agent/sessions`
- `POST /agent/sessions`
- `GET /agent/sessions/{id}`
- `GET /agent/sessions/{id}/traces` — OpenTelemetry span waterfall for the
  session (`SessionTraceView`), consumed by the hidden `#trace` page. Spans
  are in-memory and ephemeral, so this returns `{ sessionId, invocations: [] }`
  after a sidecar restart.
- `PATCH /agent/sessions/{id}` with `{ "title": "..." }`
- `DELETE /agent/sessions/{id}`
- `POST /agent/sessions/{id}/messages`
- `POST /agent/sessions/{id}/abort`
- `POST /agent/sessions/{id}/proposals/{proposalId}/confirm`
- `POST /agent/sessions/{id}/proposals/{proposalId}/reject`

`messages` returns NDJSON events such as `message_delta`, `tool_event`,
`source`, `proposal`, `error`, and `agent_end`.

`tool_event` and `source` payloads are appended to the session context.
The sidecar de-duplicates sources by `path` and `title`, and updates tool
events by `id`.

`PATCH /agent/sessions/{id}` trims the title and requires 1-80
characters. Invalid titles return `400 invalid_request`.

## Core Boundary

The agent uses `dikw-core` as the fact source through retrieve, page,
link, wisdom, and health endpoints. The target core URL comes from the
current browser Settings request payload. The removed `/v1/query`
endpoint is not called.

Maintenance tasks are not executed directly by the agent. The agent may
create a proposal; the UI must get explicit user confirmation before
calling core maintenance endpoints.

## Tools

ADK `FunctionTool`s are assembled in `server/agent/adkTools.ts`, reusing
the `CoreToolClient` / `WebToolClient` clients in `server/agent/tools.ts`.
They run inside the Node sidecar and never receive browser-side secrets.

Core tools (call `dikw-core`):

- `dikw_health` — `/v1/health` snapshot of provider/layer status.
- `retrieve_knowledge` — `/v1/retrieve` chunks and page refs.
- `list_pages` — `/v1/base/pages?active=true`, optional layer filter.
- `read_page` — `/v1/base/pages/{path}` body.
- `page_links` — `/v1/base/pages/{path}/links`, inbound/outbound.
- `list_wisdom` — `/v1/wisdom` with optional status/kind filters.
- `propose_maintenance_action` — emits a proposal event; never invokes
  core. UI confirmation is required.

Sidecar-only external tools (do not touch `dikw-core`):

- `web_search` — Tavily (`POST https://api.tavily.com/search`).
  Requires `DIKW_AGENT_TAVILY_API_KEY`. Descriptions are truncated to
  500 characters and at most ten results are returned. Each result
  becomes a session `source` with `kind: "web"`. Brave Search is
  implemented in `WebToolClient.search` and unit-tested but **not**
  registered in the agent's tool list, so the LLM does not see it.
- `web_fetch` — Jina Reader (`r.jina.ai/<encoded url>`). Requires
  `DIKW_AGENT_JINA_API_KEY`. Only `http(s)` URLs accepted. Markdown
  body is truncated to 50 000 characters with `truncated: true` when
  the page is larger.

Both web tools wrap fetch with `AbortSignal.timeout(15_000)` and combine
it with the per-request user abort signal via `AbortSignal.any`, so
clicking Stop in the UI cancels in-flight Tavily/Jina calls. API keys
stay in `.env.agent.local` and are never written to the session store,
streamed to the browser, or echoed in error messages.

When `HTTPS_PROXY` / `HTTP_PROXY` is set in the sidecar process
environment, the two web tools route through it via undici's
`ProxyAgent`. The proxy is **only** applied to external Tavily/Jina
calls, not to `dikw-core` requests, so a local core on
`127.0.0.1:8765` keeps working alongside an upstream proxy used to
reach the public web.
