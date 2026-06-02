import { useEffect, useMemo, useState } from "react";
import { Activity, Boxes } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { translations, type Locale } from "../i18n";
import type { AgentClientLike } from "./agentTypes";
import type { AgentMessage, AgentSession, SessionSummary } from "../agent/types";
import type { SessionTraceView, TraceInvocationView, TraceSpanView } from "../agent/traceTypes";

interface TracePageProps {
  // Live data source (Phase 3): listSessions + getSession + getSessionTraces.
  // Optional so tests / a degraded shell can render an empty page gracefully.
  agentClient?: AgentClientLike;
  locale?: Locale;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function TracePage({ agentClient, locale = "en" }: TracePageProps) {
  const copy = translations[locale].pages.trace;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [activeTrace, setActiveTrace] = useState<SessionTraceView | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the session list once the client is available; auto-select the first.
  useEffect(() => {
    if (!agentClient) {
      return;
    }
    const controller = new AbortController();
    agentClient
      .listSessions(controller.signal)
      .then((list) => {
        setSessions(list);
        setActiveId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setError(copy.errorTitle);
        }
      });
    return () => controller.abort();
  }, [agentClient, copy.errorTitle]);

  // Load the selected session's conversation + trace waterfall.
  useEffect(() => {
    if (!agentClient || !activeId) {
      setActiveSession(null);
      setActiveTrace(null);
      return;
    }
    const controller = new AbortController();
    setError(null);
    Promise.all([
      agentClient.getSession(activeId, controller.signal),
      agentClient.getSessionTraces(activeId, controller.signal)
    ])
      .then(([session, trace]) => {
        setActiveSession(session);
        setActiveTrace(trace);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setActiveSession(null);
          setActiveTrace(null);
          setError(copy.errorTitle);
        }
      });
    return () => controller.abort();
  }, [agentClient, activeId, copy.errorTitle]);

  function selectSession(id: string) {
    setActiveId(id);
    setSelectedSpanId(null);
  }

  const messages = activeSession?.messages ?? [];
  const invocations = activeTrace?.invocations ?? [];

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.description}</p>
        </div>
      </header>

      {error ? <EmptyState title={copy.errorTitle} /> : null}

      <section className="trace-shell">
        <aside className="trace-sessions" aria-label={copy.sessionsTitle}>
          <div className="trace-sessions__header">
            <strong>{copy.sessionsTitle}</strong>
          </div>
          <div className="trace-session-list">
            {sessions.length ? (
              sessions.map((session) => (
                <button
                  className={`trace-session ${activeId === session.id ? "is-active" : ""}`}
                  type="button"
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                >
                  <strong>{session.title}</strong>
                  <span>{session.lastMessagePreview || copy.emptyPreview}</span>
                </button>
              ))
            ) : (
              <EmptyState title={copy.emptySessions} />
            )}
          </div>
        </aside>

        <div className="trace-main">
          <section className="trace-pane trace-conversation" aria-label={copy.conversationTitle}>
            <div className="trace-pane__title">
              <Boxes size={16} aria-hidden="true" />
              {copy.conversationTitle}
            </div>
            {activeSession ? (
              messages.length ? (
                <div className="trace-message-list">
                  {messages.map((message) => (
                    <TraceMessage message={message} copy={copy} key={message.id} />
                  ))}
                </div>
              ) : (
                <EmptyState title={copy.emptyConversation} />
              )
            ) : (
              <EmptyState title={copy.selectSession} />
            )}
          </section>

          <section className="trace-pane trace-traces" aria-label={copy.tracesTitle}>
            <div className="trace-pane__title">
              <Activity size={16} aria-hidden="true" />
              {copy.tracesTitle}
            </div>
            {activeSession ? (
              invocations.length ? (
                <div className="trace-invocation-list">
                  {invocations.map((invocation) => (
                    <TraceInvocation
                      invocation={invocation}
                      copy={copy}
                      selectedSpanId={selectedSpanId}
                      onSelectSpan={setSelectedSpanId}
                      key={invocation.invocationId}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState title={copy.emptyTraces} />
              )
            ) : (
              <EmptyState title={copy.selectSession} />
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

type TraceCopy = (typeof translations)[Locale]["pages"]["trace"];

function TraceMessage({ message, copy }: { message: AgentMessage; copy: TraceCopy }) {
  const isUser = message.role === "user";
  return (
    <article className={`agent-message ${isUser ? "agent-message--user" : "agent-message--assistant"}`}>
      <div className="agent-message__role">{isUser ? copy.userRole : copy.assistantRole}</div>
      <p>{message.content}</p>
    </article>
  );
}

function TraceInvocation({
  invocation,
  copy,
  selectedSpanId,
  onSelectSpan
}: {
  invocation: TraceInvocationView;
  copy: TraceCopy;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string | null) => void;
}) {
  const depths = useMemo(() => computeDepths(invocation.spans), [invocation.spans]);
  const total = invocation.durationMs || 1;
  const selectedSpan = invocation.spans.find((span) => span.spanId === selectedSpanId) ?? null;

  return (
    <article className="trace-invocation">
      <header className="trace-invocation__head">
        <span className="trace-invocation__id" title={`${copy.invocationLabel} · ${invocation.invocationId}`}>
          {copy.invocationLabel} · {invocation.invocationId}
        </span>
        <span className="trace-invocation__time">{formatTimestamp(invocation.startTimeMs)}</span>
        <span className="trace-invocation__dur">{formatMs(invocation.durationMs, copy)}</span>
      </header>
      <div className="trace-waterfall" role="list">
        {invocation.spans.map((span) => {
          const offset = clamp01((span.startTimeMs - invocation.startTimeMs) / total);
          const width = clamp01(span.durationMs / total, 0.012);
          const model = typeof span.attributes["gen_ai.request.model"] === "string"
            ? (span.attributes["gen_ai.request.model"] as string)
            : null;
          return (
            <div className="trace-span-row" role="listitem" key={span.spanId}>
              <button
                className={`trace-span-row__label ${selectedSpanId === span.spanId ? "is-selected" : ""}`}
                type="button"
                title={span.name}
                style={{ paddingLeft: `${(depths[span.spanId] ?? 0) * 14}px` }}
                aria-expanded={selectedSpanId === span.spanId}
                onClick={() => onSelectSpan(selectedSpanId === span.spanId ? null : span.spanId)}
              >
                <span className={`trace-span-dot trace-span-dot--${span.status}`} aria-hidden="true" />
                <span className="trace-span-name">{span.name}</span>
              </button>
              <div className="trace-span-track">
                <span
                  className={`trace-span-bar trace-span-bar--${span.status}`}
                  style={{ left: `${offset * 100}%`, width: `${width * 100}%` }}
                />
              </div>
              <span className="trace-span-row__meta">
                <span className="trace-span-time" title={formatTimestamp(span.startTimeMs)}>
                  {formatClock(span.startTimeMs)}
                </span>
                <span className="trace-span-row__dur">{formatMs(span.durationMs, copy)}</span>
                {model ? (
                  <span className="trace-model-badge" title={copy.modelLabel}>
                    {model}
                  </span>
                ) : null}
                {typeof span.tokensInput === "number" ? (
                  <span className="trace-token-badge" title={copy.tokensInLabel}>
                    ↓{span.tokensInput}
                  </span>
                ) : null}
                {typeof span.tokensOutput === "number" ? (
                  <span className="trace-token-badge" title={copy.tokensOutLabel}>
                    ↑{span.tokensOutput}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {selectedSpan ? <SpanDetail span={selectedSpan} copy={copy} /> : null}
    </article>
  );
}

function SpanDetail({ span, copy }: { span: TraceSpanView; copy: TraceCopy }) {
  const entries = Object.entries(span.attributes);
  return (
    <div className="trace-span-detail">
      <div className="trace-span-detail__title">{copy.spanDetailTitle}</div>
      {entries.length ? (
        <dl className="trace-attr-list">
          {entries.map(([key, value]) => (
            <div className="trace-attr" key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="trace-span-detail__empty">{copy.emptyAttributes}</p>
      )}
    </div>
  );
}

function computeDepths(spans: TraceSpanView[]): Record<string, number> {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const depths: Record<string, number> = {};
  const resolve = (span: TraceSpanView, guard: number): number => {
    if (span.spanId in depths) {
      return depths[span.spanId];
    }
    const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
    const depth = parent && guard > 0 ? resolve(parent, guard - 1) + 1 : 0;
    depths[span.spanId] = depth;
    return depth;
  };
  for (const span of spans) {
    resolve(span, spans.length);
  }
  return depths;
}

function clamp01(value: number, min = 0): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(1, Math.max(min, value));
}

function formatMs(ms: number, copy: TraceCopy): string {
  return `${Math.round(ms)} ${copy.durationUnit}`;
}

// UTC, deterministic regardless of host timezone (keeps tests stable).
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function formatClock(ms: number): string {
  // HH:MM:SS.mmm slice of the ISO string.
  return new Date(ms).toISOString().slice(11, 23);
}
