import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import type { TaskEvent, TaskRow, TaskStatus } from "../types";
import { formatDuration, formatIso, formatNumber, formatScore, isTerminalTask } from "../utils/format";

interface TasksPageProps {
  client: DikwClient;
}

const taskStatuses: Array<"" | TaskStatus> = ["", "pending", "running", "succeeded", "failed", "cancelled"];

export function TasksPage({ client }: TasksPageProps) {
  const [status, setStatus] = useState<"" | TaskStatus>("");
  const [op, setOp] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState<unknown>(null);
  const [following, setFollowing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      client.get<TaskRow[]>("/v1/tasks", {
        signal,
        params: {
          status: status || undefined,
          op: op.trim() || undefined,
          limit: 100
        }
      }),
    [client, op, status]
  );
  const tasks = useAsyncResource(load, [client, op, status]);
  const selected = useMemo(() => (tasks.data ?? []).find((task) => task.task_id === selectedId) ?? null, [selectedId, tasks.data]);

  useEffect(() => {
    if (!selectedId && tasks.data?.length) {
      setSelectedId(tasks.data[0].task_id);
    }
  }, [selectedId, tasks.data]);

  async function follow(row: TaskRow) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSelectedId(row.task_id);
    setEvents([]);
    setEventsError(null);
    setFollowing(true);
    try {
      for await (const event of client.streamTaskEvents(row.task_id, undefined, controller.signal)) {
        setEvents((value) => [...value, event]);
        if (event.type === "final") {
          break;
        }
      }
    } catch (nextError) {
      if (!controller.signal.aborted) {
        setEventsError(nextError);
      }
    } finally {
      setFollowing(false);
    }
  }

  function stopFollow() {
    controllerRef.current?.abort();
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>任务查看</h1>
        </div>
        <button className="icon-button" type="button" onClick={tasks.reload} aria-label="刷新任务">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="panel filter-bar">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | TaskStatus)}>
            {taskStatuses.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Op</span>
          <input value={op} onChange={(event) => setOp(event.target.value)} placeholder="ingest / synth / distill" />
        </label>
      </section>

      {tasks.error ? <Notice title="无法读取任务列表" error={tasks.error} /> : null}

      <section className="tasks-layout">
        <div className="panel task-list-panel">
          {(tasks.data ?? []).length ? (
            <div className="task-list">
              {(tasks.data ?? []).map((task) => (
                <button
                  className={`task-list__item ${selectedId === task.task_id ? "is-selected" : ""}`}
                  key={task.task_id}
                  type="button"
                  onClick={() => {
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
          ) : (
            <EmptyState title="没有任务记录" />
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
              {eventsError ? <Notice title="无法读取任务事件" error={eventsError} /> : null}
              <EventTape events={events} following={following} selected={selected} />
            </>
          ) : (
            <EmptyState title="选择一个任务" />
          )}
        </aside>
      </section>
    </div>
  );
}

function EventTape({ events, following, selected }: { events: TaskEvent[]; following: boolean; selected: TaskRow }) {
  if (!events.length) {
    return (
      <div className="event-empty">
        <EmptyState
          title={following ? "等待事件" : "事件尚未加载"}
          detail={isTerminalTask(selected.status) ? "点击 Load events 查看任务事件时间线。" : "点击 Follow 跟随任务事件流。"}
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
            <EventBody event={event} op={selected.op} />
          </article>
        ))}
      </div>
    </section>
  );
}

function EventBody({ event, op }: { event: TaskEvent; op: string }) {
  if (event.type === "progress") {
    return (
      <div>
        <div className="event-progress-heading">
          <strong>{event.phase}</strong>
          {event.detail ? <span>{compactDetail(event.detail)}</span> : null}
        </div>
        <div className="progress-bar" aria-label={`${event.current}/${event.total}`}>
          <span style={{ width: `${event.total ? Math.min(100, (event.current / event.total) * 100) : 0}%` }} />
        </div>
        <small>
          {event.current}/{event.total}
        </small>
      </div>
    );
  }
  if (event.type === "log") {
    return <p>{event.level}: {event.message}</p>;
  }
  if (event.type === "partial") {
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

function TaskResultSummary({ op, result, compact = false }: { op: string; result: Record<string, unknown>; compact?: boolean }) {
  if (op === "eval" || "metrics" in result) {
    return <EvalResultSummary result={result} compact={compact} />;
  }

  const entries = Object.entries(result).filter(([, value]) => typeof value !== "object" || value === null);
  return (
    <section className={`result-summary ${compact ? "result-summary--compact" : ""}`}>
      <div className="section-title">
        <span>Result</span>
      </div>
      <div className="summary-metrics">
        {entries.map(([key, value]) => (
          <div className="summary-metric" key={key}>
            <dt>{key}</dt>
            <dd>{String(value ?? "-")}</dd>
          </div>
        ))}
      </div>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
