# 1. Task list uses "Load more", not numbered pagination

dikw-core 0.2.0 changed `GET /v1/tasks` to a forward-only keyset cursor
envelope (`next_cursor` / `has_more`) with no total count and no native
"previous". We render the task list with a "Load more" append model rather
than the project's `PaginationBar` (prev/next + "page X of Y"), because a
one-directional cursor with no total can't honestly drive a numbered pager.
`PaginationBar` is kept for the event tape, which still has a bounded,
in-memory event count.

## Status

Accepted (2026-05-20).

## Considered options

- **Cursor-stack prev/next** — keep `PaginationBar` by caching visited
  cursors. Rejected: still can't show a real total, and adds stack state for a
  "back" that the cursor doesn't natively support.
- **Client page + tail-fetch** — keep the 20/page bar and auto-fetch the next
  server page when the user reaches the end. Rejected: the "of Y" total grows
  as you load, which is confusing semantics.

## Consequences

- List and event-tape pagination interactions now differ (append vs. paged).
- Going "back" relies on scrolling the accumulated list, not page navigation.
