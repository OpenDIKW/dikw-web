import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { translations, type Locale } from "../i18n";
import type { IngestError, TaskEvent, TaskHandle, TaskRow, TaskRowSummary, TaskStatus } from "../types";
import { formatDuration, formatIso, formatNumber, formatScore, isTerminalTask } from "../utils/format";

interface TasksPageProps {
  client: DikwClient;
  locale?: Locale;
}

type ProgressEvent = Extract<TaskEvent, { type: "progress" }>;
type FinalEvent = Extract<TaskEvent, { type: "final" }>;
type TaskPatch = Pick<TaskRow, "status" | "finished_at" | "result" | "error">;
type TaskListItem = TaskRowSummary & {
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};
type TasksCopy = (typeof translations)["en"]["pages"]["tasks"];

const taskStatuses: Array<"" | TaskStatus> = ["", "pending", "running", "succeeded", "failed", "cancelled"];
const PAGE_LIMIT = 20;
const EVENT_PAGE_SIZE = 20;
const BUSY_POLL_MS = 4000;

export function TasksPage({ client, locale = "en" }: TasksPageProps) {
  const copy = translations[locale].pages.tasks;
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [op, setOp] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState<unknown>(null);
  const [following, setFollowing] = useState(false);
  const [eventPageIndex, setEventPageIndex] = useState(0);
  const [eventStickTail, setEventStickTail] = useState(true);
  const [taskPatches, setTaskPatches] = useState<Record<string, TaskPatch>>({});
  // The task currently being followed. Kept so the detail pane can render it
  // even when the active Status/Op filter excludes it from the list (e.g. a
  // freshly-fired op that doesn't match the filter).
  const [followedRow, setFollowedRow] = useState<TaskListItem | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const eventTapeTaskIdRef = useRef<string | null>(null);

  const hydratedRef = useRef<Set<string>>(new Set());
  // Bumped on every list reset (filter change or Refresh). In-flight page
  // requests capture the value and bail if a newer reset superseded them.
  const listGenRef = useRef(0);
  const [rows, setRows] = useState<TaskRowSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [listError, setListError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Toolbar operation actions (ingest / synth / lint propose+apply).
  // `busyTaskId` is the poll-observed running/pending task that gates the fire
  // buttons; `actionPending` covers the brief click→POST window before a task
  // id exists. The detail-panel Stop cancels `busyTaskId`'s task.
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const busyPollControllerRef = useRef<AbortController | null>(null);
  const busyPollGenRef = useRef(0);
  const busy = actionPending || busyTaskId !== null;

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      const gen = ++listGenRef.current;
      setListError(null);
      try {
        const page = await client.listTasks(
          { status: status || undefined, op: op.trim() || undefined, limit: PAGE_LIMIT },
          signal
        );
        // A newer list reset (filter change or Refresh) superseded this load.
        if (signal?.aborted || listGenRef.current !== gen) return;
        setRows(page.tasks);
        setNextCursor(page.next_cursor);
        setHasMore(page.has_more);
      } catch (error) {
        if (signal?.aborted || listGenRef.current !== gen) return;
        setListError(error);
        setRows([]);
        setNextCursor(null);
        setHasMore(false);
      }
    },
    [client, op, status]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFirstPage(controller.signal);
    return () => controller.abort();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    const gen = listGenRef.current;
    setLoadingMore(true);
    setListError(null);
    try {
      const page = await client.listTasks({
        status: status || undefined,
        op: op.trim() || undefined,
        limit: PAGE_LIMIT,
        cursor: nextCursor
      });
      // A list reset (filter change or Refresh) happened while this page was
      // in flight — discard so we neither append a stale page nor clobber the
      // refreshed cursor.
      if (listGenRef.current !== gen) return;
      setRows((prev) => [...prev, ...page.tasks]);
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (error) {
      if (listGenRef.current !== gen) return;
      if (error instanceof DikwClientError && error.code === "invalid_cursor") {
        void loadFirstPage();
        return;
      }
      setListError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [client, op, status, nextCursor, hasMore, loadingMore, loadFirstPage]);

  const visibleTasks = useMemo<TaskListItem[]>(
    () =>
      rows.map((row) => {
        const patch = taskPatches[row.task_id];
        return patch ? { ...row, ...patch } : row;
      }),
    [rows, taskPatches]
  );
  const selected = useMemo(() => {
    const fromList = visibleTasks.find((task) => task.task_id === selectedId);
    if (fromList) return fromList;
    // Followed task that the active filter keeps out of the list: render it
    // from the followed row, applying any final-event patch.
    if (followedRow && followedRow.task_id === selectedId) {
      const patch = taskPatches[followedRow.task_id];
      return patch ? { ...followedRow, ...patch } : followedRow;
    }
    return null;
  }, [selectedId, visibleTasks, followedRow, taskPatches]);
  // Lint Apply runs against the selected, succeeded lint.propose task.
  const canApply =
    !busy && selected !== null && selected.op === "lint.propose" && selected.status === "succeeded";

  useEffect(() => {
    // Never auto-reselect away from a task we're actively following — it may be
    // absent from the filtered list yet still streaming in the detail pane.
    // (Both null must NOT count as "following", or the initial auto-select is
    // suppressed when nothing is selected yet.)
    const following = eventTapeTaskIdRef.current !== null && eventTapeTaskIdRef.current === selectedId;
    if (!rows.length) {
      if (selectedId !== null && !following) setSelectedId(null);
      return;
    }
    if (!following && (!selectedId || !rows.some((task) => task.task_id === selectedId))) {
      setSelectedId(rows[0].task_id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selected || !isTerminalTask(selected.status)) return;
    if (selected.result !== undefined || hydratedRef.current.has(selected.task_id)) return;
    const taskId = selected.task_id;
    hydratedRef.current.add(taskId);
    client
      .getTask(taskId)
      .then((full) => {
        if (!full) {
          hydratedRef.current.delete(taskId);
          return;
        }
        setTaskPatches((value) => ({
          ...value,
          [full.task_id]: {
            status: full.status,
            finished_at: full.finished_at,
            result: full.result,
            error: full.error
          }
        }));
      })
      .catch(() => {
        hydratedRef.current.delete(taskId);
      });
  }, [selected, client]);

  const eventPageCount = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE));
  const pagedEvents = useMemo(
    () => events.slice(eventPageIndex * EVENT_PAGE_SIZE, (eventPageIndex + 1) * EVENT_PAGE_SIZE),
    [events, eventPageIndex]
  );

  useEffect(() => {
    if (eventStickTail && eventPageIndex !== eventPageCount - 1) {
      setEventPageIndex(eventPageCount - 1);
    } else if (eventPageIndex > eventPageCount - 1) {
      setEventPageIndex(eventPageCount - 1);
    }
  }, [eventPageCount, eventPageIndex, eventStickTail]);

  function changeEventPage(next: number) {
    const clamped = Math.max(0, Math.min(eventPageCount - 1, next));
    setEventPageIndex(clamped);
    setEventStickTail(clamped === eventPageCount - 1);
  }

  useEffect(() => () => controllerRef.current?.abort(), []);

  // Authoritatively detect whether core is busy, independent of the list
  // filter: poll for any running (else pending) task. Self-scheduling timeout
  // chain so ticks never overlap; only writes `busyTaskId`, never the
  // filter-scoped list state. Restarts when the client (core URL) changes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const gen = ++busyPollGenRef.current;
      busyPollControllerRef.current?.abort();
      const controller = new AbortController();
      busyPollControllerRef.current = controller;
      try {
        const running = await client.listTasks({ status: "running", limit: 1 }, controller.signal);
        if (cancelled || busyPollGenRef.current !== gen) return;
        let target = running.tasks[0]?.task_id ?? null;
        if (!target) {
          const pending = await client.listTasks({ status: "pending", limit: 1 }, controller.signal);
          if (cancelled || busyPollGenRef.current !== gen) return;
          target = pending.tasks[0]?.task_id ?? null;
        }
        setBusyTaskId(target);
      } catch {
        // Transient poll failure — keep the last known busy state.
      } finally {
        if (!cancelled) timer = setTimeout(() => void tick(), BUSY_POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      busyPollControllerRef.current?.abort();
    };
  }, [client]);

  function cancelFollow() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setFollowing(false);
  }

  function applyFinalEvent(taskId: string, event: FinalEvent) {
    setTaskPatches((value) => ({
      ...value,
      [taskId]: {
        status: event.status,
        finished_at: event.ts,
        result: event.result ?? null,
        error: event.error ?? null
      }
    }));
  }

  async function follow(row: TaskListItem) {
    cancelFollow();
    const controller = new AbortController();
    controllerRef.current = controller;
    eventTapeTaskIdRef.current = row.task_id;
    setFollowedRow(row);
    setSelectedId(row.task_id);
    setEvents([]);
    setEventsError(null);
    setEventPageIndex(0);
    setEventStickTail(!isTerminalTask(row.status));
    setFollowing(true);
    try {
      for await (const event of client.streamTaskEvents(row.task_id, undefined, controller.signal)) {
        if (controllerRef.current !== controller) {
          break;
        }
        setEvents((value) => [...value, event]);
        if (event.type === "final") {
          applyFinalEvent(row.task_id, event);
          break;
        }
      }
    } catch (nextError) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        setEventsError(nextError);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setFollowing(false);
      }
    }
  }

  function refreshTasks() {
    hydratedRef.current.clear();
    setTaskPatches({});
    void loadFirstPage();
    if (selected && isTerminalTask(selected.status) && eventTapeTaskIdRef.current === selected.task_id) {
      void follow(selected);
    }
  }

  // Fire a maintenance op, then refresh the list and follow the new task.
  // Plain function (not memoized): its closure reads `busy`/`follow`, which
  // change identity every render, so a useCallback here would never hold.
  const fireOp = async (start: (signal: AbortSignal) => Promise<TaskHandle>) => {
    if (busy) return;
    setActionPending(true);
    setActionError(null);
    const controller = new AbortController();
    try {
      const handle = await start(controller.signal);
      // The op is now running. Invalidate any in-flight poll so it can't
      // clobber the optimistic target, then hand off from actionPending.
      busyPollGenRef.current += 1;
      setBusyTaskId(handle.task_id);
      setActionPending(false);
      await loadFirstPage();
      void follow({
        task_id: handle.task_id,
        op: handle.op,
        status: handle.status,
        created_at: handle.created_at,
        started_at: null,
        finished_at: null,
        params_digest: ""
      });
    } catch (error) {
      setActionPending(false);
      setActionError(error);
    }
  };

  const onIngest = () => void fireOp((signal) => client.startIngest({}, signal));
  const onSynth = () => void fireOp((signal) => client.startSynth({}, signal));
  const onLintPropose = () => void fireOp((signal) => client.startLintPropose({}, signal));
  const onLintApply = () => {
    if (!canApply || !selected) return;
    const proposalTaskId = selected.task_id;
    void fireOp((signal) => client.startLintApply({ proposalTaskId, pick: null }, signal));
  };

  // Detail-panel Stop: cancel the selected running/pending task on core.
  // We intentionally do NOT cancelFollow() here — if this task is being
  // followed, the live stream renders the resulting final(cancelled) event as
  // confirmation and then settles `following` on its own.
  const cancelSelected = async () => {
    if (!selected || isTerminalTask(selected.status)) return;
    const id = selected.task_id;
    setActionError(null);
    try {
      await client.cancelTask(id);
      busyPollGenRef.current += 1;
      setBusyTaskId((current) => (current === id ? null : current));
      void loadFirstPage();
    } catch (error) {
      setActionError(error);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={refreshTasks} aria-label={copy.refresh}>
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="panel filter-bar">
        <label className="field">
          <span>{copy.statusLabel}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | TaskStatus)}>
            {taskStatuses.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{copy.opLabel}</span>
          <input value={op} onChange={(event) => setOp(event.target.value)} placeholder="ingest / synth / distill" />
        </label>
        <div className="task-actions">
          <button className="secondary-button" type="button" onClick={onIngest} disabled={busy}>
            {copy.actions.ingest}
          </button>
          <button className="secondary-button" type="button" onClick={onSynth} disabled={busy}>
            {copy.actions.synth}
          </button>
          <button className="secondary-button" type="button" onClick={onLintPropose} disabled={busy}>
            {copy.actions.lintPropose}
          </button>
          <button className="secondary-button" type="button" onClick={onLintApply} disabled={!canApply}>
            {copy.actions.lintApply}
          </button>
          {busy ? (
            <span className="task-actions__live" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              {copy.actions.running}
            </span>
          ) : null}
        </div>
      </section>

      {actionError ? <Notice title={copy.actions.errorTitle} error={actionError} /> : null}
      {listError ? <Notice title={copy.listErrorTitle} error={listError} /> : null}

      <section className="tasks-layout">
        <div className="panel task-list-panel">
          {visibleTasks.length ? (
            <>
              <div className="task-list">
                {visibleTasks.map((task) => (
                  <button
                    className={`task-list__item ${selectedId === task.task_id ? "is-selected" : ""}`}
                    key={task.task_id}
                    type="button"
                    onClick={() => {
                      cancelFollow();
                      eventTapeTaskIdRef.current = null;
                      setSelectedId(task.task_id);
                      setEvents([]);
                      setEventsError(null);
                      setEventPageIndex(0);
                      setEventStickTail(true);
                    }}
                  >
                    <span className="task-list__topline">
                      <strong>{task.op}</strong>
                      <StatusPill status={task.status} />
                    </span>
                    <span className="task-list__id">{task.task_id}</span>
                    <span className="task-list__meta">
                      <span>{formatIso(task.created_at)}</span>
                      <span>{formatDuration(task.started_at, task.finished_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
              {hasMore ? (
                <div className="task-list__more">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? copy.loadingMore : copy.loadMore}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title={copy.taskListEmpty} />
          )}
        </div>

        <aside className="panel task-detail">
          {selected ? (
            <>
              <div className="task-detail__header">
                <div>
                  <div className="reader-header__path">{selected.task_id}</div>
                  <h2>{selected.op}</h2>
                </div>
                <StatusPill status={selected.status} />
              </div>
              <dl className="task-summary-grid">
                <div>
                  <dt>created</dt>
                  <dd>{formatIso(selected.created_at)}</dd>
                </div>
                <div>
                  <dt>duration</dt>
                  <dd>{formatDuration(selected.started_at, selected.finished_at)}</dd>
                </div>
                <div>
                  <dt>digest</dt>
                  <dd>{selected.params_digest || "-"}</dd>
                </div>
              </dl>
              {selected.result ? <TaskResultSummary op={selected.op} result={selected.result} /> : null}
              {selected.error ? <TaskErrorSummary error={selected.error} /> : null}
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => follow(selected)} disabled={following}>
                  <Play size={16} />
                  {isTerminalTask(selected.status) ? "Load events" : "Follow"}
                </button>
                <button
                  className="secondary-button secondary-button--danger"
                  type="button"
                  onClick={() => void cancelSelected()}
                  disabled={isTerminalTask(selected.status)}
                >
                  <Square size={16} />
                  Stop
                </button>
              </div>
              {eventsError ? <Notice title={copy.eventsErrorTitle} error={eventsError} /> : null}
              <EventTape
                events={events}
                pagedEvents={pagedEvents}
                eventPageIndex={eventPageIndex}
                eventPageCount={eventPageCount}
                onChangeEventPage={changeEventPage}
                following={following}
                selected={selected}
                copy={copy}
              />
            </>
          ) : (
            <EmptyState title={copy.selectTask} />
          )}
        </aside>
      </section>
    </div>
  );
}

function EventTape({
  events,
  pagedEvents,
  eventPageIndex,
  eventPageCount,
  onChangeEventPage,
  following,
  selected,
  copy
}: {
  events: TaskEvent[];
  pagedEvents: TaskEvent[];
  eventPageIndex: number;
  eventPageCount: number;
  onChangeEventPage: (next: number) => void;
  following: boolean;
  selected: TaskListItem;
  copy: TasksCopy;
}) {
  if (!events.length) {
    return (
      <div className="event-empty">
        <EmptyState
          title={following ? copy.waitingEvents : copy.eventsNotLoaded}
          detail={isTerminalTask(selected.status) ? copy.terminalEventDetail : copy.runningEventDetail}
        />
      </div>
    );
  }
  return (
    <section className="event-section">
      <div className="section-title">
        <span>Event tape</span>
        <span className="soft-label">{events.length} events</span>
      </div>
      <div className="event-tape">
        {pagedEvents.map((event) => (
          <article className={`event-tape__item event-tape__item--${event.type}`} key={`${event.seq}-${event.type}-${event.ts}`}>
            <div className="event-tape__meta">
              <span>#{event.seq}</span>
              <span>{event.type}</span>
              <span>{formatIso(event.ts)}</span>
            </div>
            <EventBody event={event} op={selected.op} copy={copy} />
          </article>
        ))}
      </div>
      <PaginationBar
        pageIndex={eventPageIndex}
        pageCount={eventPageCount}
        copy={copy.eventPagination}
        onChange={onChangeEventPage}
        className="event-tape__pagination"
      />
    </section>
  );
}

function EventBody({ event, op, copy }: { event: TaskEvent; op: string; copy: TasksCopy }) {
  if (event.type === "progress") {
    const detail = event.detail ? compactDetail(event.detail) : "";
    const percentage = progressPercentage(event);
    const progressLabel = formatProgressLabel(event, copy);
    const progressBarClass = [
      "progress-bar",
      percentage === null ? "progress-bar--indeterminate" : "",
      percentage === null && event.phase === "scan" ? "progress-bar--scan" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div>
        <div className="event-progress-heading">
          <strong>{event.phase}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
        <div className={progressBarClass} aria-label={progressLabel}>
          <span style={percentage === null ? undefined : { width: `${percentage}%` }} />
        </div>
        <small>{progressLabel}</small>
      </div>
    );
  }
  if (event.type === "log") {
    return <p>{event.level}: {event.message}</p>;
  }
  if (event.type === "partial") {
    if (event.kind === "file_error") {
      return <FileErrorCard error={normalizeIngestError(event.payload)} />;
    }
    return <JsonDetails summary={`partial · ${event.kind}`} value={event.payload} />;
  }
  if (event.type === "final") {
    return (
      <div className="final-event">
        <StatusPill status={event.status} />
        {event.result ? <TaskResultSummary op={op} result={event.result} compact /> : null}
        {event.error ? <TaskErrorSummary error={event.error} /> : null}
        <JsonDetails summary="Raw final event" value={event} />
      </div>
    );
  }
  if (event.type === "error") {
    return <p>{event.code}: {event.message}</p>;
  }
  return <p>{event.op}</p>;
}

function progressPercentage(event: ProgressEvent): number | null {
  if (event.total <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (event.current / event.total) * 100));
}

function formatProgressLabel(event: ProgressEvent, copy: TasksCopy): string {
  if (event.total > 0) {
    return `${formatNumber(event.current)}/${formatNumber(event.total)}`;
  }
  if (event.current <= 0) {
    return `${copy.waitingForCount} · ${copy.totalUnknown}`;
  }
  const verb = event.phase === "scan" ? copy.scanned : copy.processed;
  return `${verb} ${formatNumber(event.current)} · ${copy.totalUnknown}`;
}

function TaskResultSummary({ op, result, compact = false }: { op: string; result: Record<string, unknown>; compact?: boolean }) {
  if (op === "eval" || "metrics" in result) {
    return <EvalResultSummary result={result} compact={compact} />;
  }

  const entries = Object.entries(result).filter(([, value]) => typeof value !== "object" || value === null);
  const ingestErrors = op === "ingest" ? getIngestErrors(result.errors) : [];
  return (
    <section className={`result-summary ${compact ? "result-summary--compact" : ""}`}>
      <div className="section-title">
        <span>Result</span>
      </div>
      <div className="summary-metrics">
        {ingestErrors.length ? (
          <div className="summary-metric summary-metric--warn">
            <dt>file errors</dt>
            <dd>{formatFileErrorCount(ingestErrors.length)}</dd>
          </div>
        ) : null}
        {entries.map(([key, value]) => (
          <div className="summary-metric" key={key}>
            <dt>{key}</dt>
            <dd>{String(value ?? "-")}</dd>
          </div>
        ))}
      </div>
      {ingestErrors.length ? <FileErrorList errors={ingestErrors} compact={compact} /> : null}
      <JsonDetails summary="Raw result JSON" value={result} />
    </section>
  );
}

function EvalResultSummary({ result, compact }: { result: Record<string, unknown>; compact?: boolean }) {
  const metrics = isRecord(result.metrics) ? result.metrics : {};
  const thresholds = isRecord(result.thresholds) ? result.thresholds : {};
  const perQuery = Array.isArray(result.per_query) ? result.per_query : [];
  const negatives = Array.isArray(result.negative_diagnostics) ? result.negative_diagnostics : [];
  const metricRows = Object.entries(metrics).filter(([, value]) => typeof value === "number");

  return (
    <section className={`result-summary ${compact ? "result-summary--compact" : ""}`}>
      <div className="section-title">
        <span>Eval result</span>
        {typeof result.passed === "boolean" ? <StatusPill status={result.passed ? "succeeded" : "failed"} label={result.passed ? "passed" : "failed"} /> : null}
      </div>
      <div className="eval-dataset-line">
        <strong>{String(result.dataset_name ?? "eval")}</strong>
        {Array.isArray(result.modes) ? <span>{result.modes.join(", ")}</span> : null}
        {Array.isArray(result.views) ? <span>{result.views.join(", ")}</span> : null}
      </div>
      <div className="summary-metrics">
        <div className="summary-metric">
          <dt>queries</dt>
          <dd>{formatNumber(perQuery.length)}</dd>
        </div>
        <div className="summary-metric">
          <dt>negative probes</dt>
          <dd>{formatNumber(negatives.length)}</dd>
        </div>
        {metricRows.slice(0, compact ? 4 : 10).map(([key, value]) => (
          <div className="summary-metric" key={key}>
            <dt>{key}</dt>
            <dd>{formatScore(value as number)}</dd>
          </div>
        ))}
      </div>
      {!compact && metricRows.length ? <MetricTable metrics={metrics} thresholds={thresholds} /> : null}
      <JsonDetails summary="Raw eval JSON" value={result} />
    </section>
  );
}

function MetricTable({ metrics, thresholds }: { metrics: Record<string, unknown>; thresholds: Record<string, unknown> }) {
  return (
    <div className="metrics-table">
      <div className="metrics-table__row metrics-table__head">
        <span>Metric</span>
        <span>Value</span>
        <span>Threshold</span>
      </div>
      {Object.entries(metrics).map(([key, value]) => (
        <div className="metrics-table__row" key={key}>
          <span>{key}</span>
          <strong>{typeof value === "number" ? formatScore(value) : String(value)}</strong>
          <span>{typeof thresholds[key] === "number" ? formatScore(thresholds[key] as number) : "-"}</span>
        </div>
      ))}
    </div>
  );
}

function TaskErrorSummary({ error }: { error: Record<string, unknown> }) {
  return (
    <section className="result-summary result-summary--error">
      <div className="section-title">
        <span>Error</span>
      </div>
      <p>{String(error.message ?? error.reason ?? "Task failed")}</p>
      <JsonDetails summary="Raw error JSON" value={error} />
    </section>
  );
}

function JsonDetails({ summary, value }: { summary: string; value: unknown }) {
  return (
    <details className="json-details">
      <summary>{summary}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function FileErrorList({ errors, compact }: { errors: IngestError[]; compact?: boolean }) {
  return (
    <div className={`file-error-list ${compact ? "file-error-list--compact" : ""}`}>
      {errors.slice(0, compact ? 2 : 8).map((error) => (
        <FileErrorCard error={error} key={`${error.kind}-${error.path}-${error.message}`} />
      ))}
    </div>
  );
}

function FileErrorCard({ error }: { error: IngestError }) {
  return (
    <div className="file-error-card">
      <div className="file-error-card__title">
        <strong>File error</strong>
        <span>{error.kind}</span>
      </div>
      <div className="file-error-card__path">{error.path}</div>
      <p>{error.message}</p>
    </div>
  );
}

function getIngestErrors(value: unknown): IngestError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeIngestError).filter((error) => error.path || error.message);
}

function normalizeIngestError(value: unknown): IngestError {
  if (!isRecord(value)) {
    return { path: "-", kind: "parse_error", message: "Unknown file error" };
  }
  const kind = value.kind;
  return {
    path: String(value.path ?? "-"),
    kind: kind === "read_error" || kind === "storage_error" || kind === "parse_error" ? kind : "parse_error",
    message: String(value.message ?? "Unknown file error")
  };
}

function formatFileErrorCount(count: number): string {
  return `${formatNumber(count)} file ${count === 1 ? "error" : "errors"}`;
}

function compactDetail(detail: Record<string, unknown>): string {
  const qid = detail.q_id;
  const path = detail.path;
  const outcome = detail.outcome;
  const mode = detail.mode;
  const parts = [mode, qid, path, outcome].filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!parts.length) {
    return "";
  }
  return parts.join(" · ");
}

function PaginationBar({
  pageIndex,
  pageCount,
  copy,
  onChange,
  className = "task-list__pagination"
}: {
  pageIndex: number;
  pageCount: number;
  copy: TasksCopy["eventPagination"];
  onChange: (next: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const label = copy.pageOf
    .replace("{current}", String(pageIndex + 1))
    .replace("{total}", String(pageCount));
  return (
    <nav className={className} aria-label={copy.ariaLabel}>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(pageIndex - 1)}
        disabled={pageIndex === 0}
      >
        {copy.prev}
      </button>
      <span className="soft-label">{label}</span>
      <button
        type="button"
        className="secondary-button"
        onClick={() => onChange(pageIndex + 1)}
        disabled={pageIndex >= pageCount - 1}
      >
        {copy.next}
      </button>
    </nav>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
