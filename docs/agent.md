# Pi Agent Sidecar

`dikw-web` runs Pi Agent in a Node sidecar and exposes same-origin
`/agent/*` routes to the browser. The browser never receives LLM keys;
it only streams Agent events and reads persisted session metadata.

The same sidecar process also serves `/web/*` for non-agent browser
helpers (see `server/web/` — currently the mineru-backed PDF / Office
converter consumed by ImportPage). Those routes do not call Pi Agent and
do not touch `dikw-core`; they exist purely so the browser can offload
external-API calls that would otherwise hit CORS or expose vendor keys.
Keep new browser-helper endpoints under `/web/*`, not under `/agent/*`.

## Configuration

Local credentials live in `.env.agent.local`, which is ignored by Git
through `*.local`. Use `.env.agent.example` as the template:

```dotenv
DIKW_AGENT_PROVIDER=minimax
DIKW_AGENT_API=anthropic-messages
DIKW_AGENT_API_KEY=<MiniMax key>
DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic
DIKW_AGENT_MODEL=MiniMax-M2.7
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

Sessions are stored in `.agent-sessions/`, one JSON file per session.
The directory is ignored by Git and is local to the workstation.

Session files store messages, tool call summaries, source references,
and maintenance proposal status. They must not store MiniMax or other
LLM API keys, core bearer tokens, or browser session storage values.

Sources and tool call summaries are session-level context. The Chat UI
shows the accumulated context for the open session instead of filtering
it by assistant reply. This keeps the right rail stable while users read
or scroll through the conversation history.

Each session has a `title`. New sessions start as `New chat`; the first
user message auto-generates a title only while the title is still the
default. Users can rename a chat from the web UI, and that manual title
is persisted in the same session JSON file.

The sidecar writes sessions via temporary file plus rename to reduce
partial-write risk. Reopening a historical session reconstructs context
from the transcript instead of relying on a previous in-memory Pi Agent
object.

## API

- `GET /agent/sessions`
- `POST /agent/sessions`
- `GET /agent/sessions/{id}`
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

Pi Agent uses `dikw-core` as the fact source through retrieve, page,
link, wisdom, and health endpoints. The target core URL comes from the
current browser Settings request payload. The removed `/v1/query`
endpoint is not called.

Maintenance tasks are not executed directly by the Agent. The Agent may
create a proposal; the UI must get explicit user confirmation before
calling core maintenance endpoints.

## Tools

All tools are defined in `server/agent/tools.ts`. They run inside the
Node sidecar and never receive browser-side secrets.

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
clicking Stop in the UI cancels in-flight Brave/Jina calls. API keys
stay in `.env.agent.local` and are never written to session JSON files,
streamed to the browser, or echoed in error messages.

When `HTTPS_PROXY` / `HTTP_PROXY` is set in the sidecar process
environment, the two web tools route through it via undici's
`ProxyAgent`. The proxy is **only** applied to external Brave/Jina
calls, not to `dikw-core` requests, so a local core on
`127.0.0.1:8765` keeps working alongside an upstream proxy used to
reach the public web.
