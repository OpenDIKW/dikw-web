# Pi Agent Sidecar

`dikw-web` runs Pi Agent in a Node sidecar and exposes same-origin
`/agent/*` routes to the browser. The browser never receives LLM keys;
it only streams Agent events and reads persisted session metadata.

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

Each user prompt starts a new turn. The sidecar assigns a `turnId` to
that turn and writes the same value on the user message, assistant
message, tool call events, and source references produced by the turn.
The web UI uses this to show sources and tool calls for the selected
assistant reply instead of showing stale session-wide context.

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

`tool_event` and `source` payloads include the current `turnId` when they
come from a live Agent turn. Older session files may not have `turnId`;
the UI keeps those records for compatibility but does not attach them to
the newest reply by default.

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
