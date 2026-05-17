import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import type { IngestError, TaskEvent, TaskRow, TaskStatus } from "../types";
import { formatDuration, formatIso, formatNumber, formatScore, isTerminalTask } from "../utils/format";

interface TasksPageProps {
  client: DikwClient;
  locale?: Locale;
}

type ProgressEvent = Extract<TaskEvent, { type: "progress" }>;
type FinalEvent = Extract<TaskEvent, { type: "final" }>;
type TaskPatch = Pick<TaskRow, "status" | "finished_at" | "result" | "error">;
type TasksCopy = (typeof translations)["en"]["pages"]["tasks"];

const taskStatuses: Array<"" | TaskStatus> = ["", "pending", "running", "succeeded", "failed", "cancelled"];
const PAGE_SIZE = 20;

export function TasksPage({ client, locale = "en" }: TasksPageProps) {
  const copy = translations[locale].pages.tasks;
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [op, setOp] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState<unknown>(null);
  const [following, setFollowing] = useState(false);
  const [taskPatches, setTaskPatches] = useState<Record<string, TaskPatch>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const eventTapeTaskIdRef = useRef<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      client.get<TaskRow[]>("/v1/tasks", {
        signal,
        params: {
          status: status || undefined,
          op: op.trim() || undefined,
          limit: 200
        }
      }),
    [client, op, status]
  );
  const tasks = useAsyncResource(load, [client, op, status]);
  const visibleTasks = useMemo(
    () => (tasks.data ?? []).map((task) => (taskPatches[task.task_id] ? { ...task, ...taskPatches[task.task_id] } : task)),
    [taskPatches, tasks.data]
  );
  const selected = useMemo(() => visibleTasks.find((task) => task.task_id === selectedId) ?? null, [selectedId, visibleTasks]);

  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    setPageIndex(0);
  }, [status, op]);
  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / PAGE_SIZE));
  useEffect(() => {
    if (pageIndex > pageCount - 1) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex]);
  const pagedTasks = useMemo(
    () => visibleTasks.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
    [pageIndex, visibleTasks]
  );

  useEffect(() => {
    if (!selectedId && visibleTasks.length) {
      setSelectedId(visibleTasks[0].task_id);
    }
  }, [selectedId, visibleTasks]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function cancelFollow() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setFollowing(false);
  }

  function changePage(next: number) {
    const clamped = Math.max(0, Math.min(pageCount - 1, next));
    if (clamped === pageIndex) return;
    cancelFollow();
    eventTapeTaskIdRef.current = null;
    setEvents([]);
    setEventsError(null);
    setPageIndex(clamped);
    const newPage = visibleTasks.slice(clamped * PAGE_SIZE, (clamped + 1) * PAGE_SIZE);
    if (newPage.length && !newPage.some((task) => task.task_id === selectedId)) {
      setSelectedId(newPage[0].task_id);
    }
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

  async function follow(row: TaskRow) {
    cancelFollow();
    const controller = new AbortController();
    controllerRef.current = controller;
    eventTapeTaskIdRef.current = row.task_id;
    setSelectedId(row.task_id);
    setEvents([]);
    setEventsError(null);
    setFollowing(true);
    let sawFinalEvent = false;
    try {
      for await (const event of client.streamTaskEvents(row.task_id, undefined, controller.signal)) {
        if (controllerRef.current !== controller) {
          break;
        }
        setEvents((value) => [...value, event]);
        if (event.type === "final") {
          sawFinalEvent = true;
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
        if (sawFinalEvent) {
          tasks.reload();
        }
      }
    }
  }

  function stopFollow() {
    cancelFollow();
  }

  function refreshTasks() {
    tasks.reload();
    if (selected && isTerminalTask(selected.status) && eventTapeTaskIdRef.current === selected.task_id) {
      void follow(selected);
    }
  }

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
      </section>

      {tasks.error ? <Notice title={copy.listErrorTitle} error={tasks.error} /> : null}

      <section className="tasks-layout">
        <div className="panel task-list-panel">
          {(tasks.data ?? []).length ? (
            <>
              <div className="task-list">
                {pagedTasks.map((task) => (
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
              <PaginationBar
                pageIndex={pageIndex}
                pageCount={pageCount}
                copy={copy.pagination}
                onChange={changePage}
              />
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
                <button className="secondary-button" type="button" onClick={stopFollow} disabled={!following}>
                  <Pause size={16} />
                  Stop
                </button>
              </div>
              {eventsError ? <Notice title={copy.eventsErrorTitle} error={eventsError} /> : null}
              <EventTape events={events} following={following} selected={selected} copy={copy} />
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
  following,
  selected,
  copy
}: {
  events: TaskEvent[];
  following: boolean;
  selected: TaskRow;
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
        {events.map((event) => (
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
  onChange
}: {
  pageIndex: number;
  pageCount: number;
  copy: TasksCopy["pagination"];
  onChange: (next: number) => void;
}) {
  if (pageCount <= 1) return null;
  const label = copy.pageOf
    .replace("{current}", String(pageIndex + 1))
    .replace("{total}", String(pageCount));
  return (
    <nav className="task-list__pagination" aria-label="task pagination">
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
