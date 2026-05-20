# dikw-web

The read-only React/Vite knowledge workbench over dikw-core. This glossary
captures the terms that shape how the web layer consumes the core task
contract, where the wire vocabulary is easy to confuse.

## Language

**Task summary**:
A list-projection row from `GET /v1/tasks` (`TaskRowSummary`) — metadata only,
with no `result`/`error`. Exists to find tasks, not to read their bodies.
_Avoid_: task row, full task

**Task row**:
The full task record from `GET /v1/tasks/{id}` (`TaskRow`), including `result`
and `error`. The detail pane's result/error source.
_Avoid_: task summary

**List cursor**:
The opaque base64url `cursor`/`next_cursor` on `GET /v1/tasks`; forward-only
keyset over `(created_at DESC, task_id ASC)` with no total count.
_Avoid_: offset, page number, event cursor

**Event cursor**:
The integer `from_seq`/`next_from_seq` on `GET /v1/tasks/{id}/events`; a
per-task sequence cursor used to long-poll a task's events.
_Avoid_: list cursor, offset

**Task** (operational):
An envelope for a long-running core op (ingest / synth / distill / eval /
lint), tracked by `task_id`. Not a DIKW domain entity.
_Avoid_: job, run

## Relationships

- A **task** is summarized as a **task summary** in the list and read in full
  as a **task row** in the detail pane.
- `GET /v1/tasks` returns many **task summaries** plus one **list cursor**.
- A **list cursor** orders **task summaries**; an **event cursor** orders the
  events of a single **task**. They never mix.

## Example dialogue

> **Dev:** "The list row is missing the eval score — can I just read `result`
> off the **task summary**?"
> **Maintainer:** "No — the **task summary** drops `result`/`error` so a 50 KB
> synth payload never crosses the wire on a list browse. Fetch the **task row**
> (`getTask`) when the row is selected, or take it from the `final` event when
> following a live task."

## Flagged ambiguities

- "cursor" was used for both list paging and event following — resolved:
  **list cursor** (opaque keyset) and **event cursor** (`from_seq`) are
  distinct mechanisms and must not be interchanged.
