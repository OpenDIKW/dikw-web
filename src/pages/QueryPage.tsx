import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText, Plus, Send, Square, Trash2, Wrench } from "lucide-react";
import type { DikwClient } from "../api/client";
import { AgentClient } from "../api/agentClient";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import type { AgentClientLike } from "./agentTypes";
import type { AgentMessage, AgentSession, AgentSource, AgentToolEvent, SessionSummary } from "../agent/types";

interface QueryPageProps {
  client?: DikwClient;
  agentClient?: AgentClientLike;
  locale?: Locale;
}

export function QueryPage({ agentClient, locale = "en" }: QueryPageProps) {
  const copy = translations[locale].pages.query;
  const resolvedAgentClient = useMemo(() => agentClient ?? new AgentClient(), [agentClient]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [draft, setDraft] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingTools, setStreamingTools] = useState<AgentToolEvent[]>([]);
  const [streamingSources, setStreamingSources] = useState<AgentSource[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialSession() {
      setLoading(true);
      setError(null);
      try {
        const existing = await resolvedAgentClient.listSessions();
        if (cancelled) {
          return;
        }
        setSessions(existing);
        if (existing[0]) {
          await openSession(existing[0].id);
        } else {
          const created = await resolvedAgentClient.createSession();
          if (!cancelled) {
            setActiveSession(created);
            setSessions([toSummary(created)]);
          }
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadInitialSession();
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
    // openSession intentionally uses the latest client through resolvedAgentClient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedAgentClient]);

  async function openSession(sessionId: string) {
    const session = await resolvedAgentClient.getSession(sessionId);
    setActiveSession(session);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStreamingTools([]);
  }

  async function createSession() {
    setError(null);
    const session = await resolvedAgentClient.createSession();
    setActiveSession(session);
    setSessions((items) => [toSummary(session), ...items]);
  }

  async function deleteSession(sessionId: string) {
    setError(null);
    await resolvedAgentClient.deleteSession(sessionId);
    const remaining = sessions.filter((item) => item.id !== sessionId);
    setSessions(remaining);
    if (activeSession?.id === sessionId) {
      if (remaining[0]) {
        await openSession(remaining[0].id);
      } else {
        await createSession();
      }
    }
  }

  async function sendMessage() {
    const message = draft.trim();
    if (!message || running) {
      return;
    }
    const session = activeSession ?? (await resolvedAgentClient.createSession());
    if (!activeSession) {
      setActiveSession(session);
      setSessions((items) => [toSummary(session), ...items]);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setDraft("");
    setError(null);
    setRunning(true);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStreamingTools([]);
    setActiveSession((current) =>
      current
        ? {
            ...current,
            messages: [...(current.messages ?? []), localMessage("user", message)]
          }
        : current
    );

    try {
      for await (const event of resolvedAgentClient.sendMessage(session.id, message, controller.signal)) {
        if (event.type === "message_delta") {
          setStreamingAnswer((value) => value + event.delta);
        } else if (event.type === "source") {
          setStreamingSources((value) => mergeSources(value, event.source));
        } else if (event.type === "tool_event") {
          setStreamingTools((value) => mergeTools(value, event.event));
        } else if (event.type === "error") {
          setError(new Error(event.message));
        }
      }
      const refreshed = await resolvedAgentClient.getSession(session.id);
      setActiveSession(refreshed);
      setSessions((items) => mergeSummary(items, toSummary(refreshed)));
      setStreamingAnswer("");
      setStreamingSources([]);
      setStreamingTools([]);
    } catch (nextError) {
      if (!controller.signal.aborted) {
        setError(nextError);
      }
    } finally {
      setRunning(false);
    }
  }

  async function stop() {
    if (!activeSession) {
      return;
    }
    controllerRef.current?.abort();
    await resolvedAgentClient.abort(activeSession.id);
    setRunning(false);
  }

  const messages = activeSession?.messages ?? [];
  const sources = [...(activeSession?.sources ?? []), ...streamingSources];
  const toolEvents = [...(activeSession?.toolEvents ?? []), ...streamingTools];

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
      </header>

      {error ? <Notice title={copy.errorTitle} error={error} /> : null}

      <section className="agent-shell">
        <aside className="agent-sessions" aria-label={copy.sessionsTitle}>
          <div className="agent-sessions__header">
            <strong>{copy.sessionsTitle}</strong>
            <button className="icon-button" type="button" aria-label={copy.newSession} onClick={createSession}>
              <Plus size={16} />
            </button>
          </div>
          {loading ? <EmptyState title={copy.loadingSessions} /> : null}
          <div className="agent-session-list">
            {sessions.map((session) => (
              <button
                className={`agent-session ${activeSession?.id === session.id ? "is-active" : ""}`}
                type="button"
                key={session.id}
                onClick={() => openSession(session.id)}
              >
                <strong>{session.title}</strong>
                <span>{session.lastMessagePreview || copy.emptySession}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="agent-chat" aria-label={copy.chatRegion}>
          <div className="agent-message-list">
            {messages.length || streamingAnswer ? (
              <>
                {messages.map((message) => (
                  <MessageBubble assistantRole={copy.assistantRole} message={message} userRole={copy.userRole} key={message.id} />
                ))}
                {streamingAnswer ? (
                  <article className="agent-message agent-message--assistant">
                    <div className="agent-message__role">{copy.assistantRole}</div>
                    <p>{streamingAnswer}</p>
                  </article>
                ) : null}
              </>
            ) : (
              <EmptyState title={copy.emptyAnswerTitle} detail={copy.emptyAnswerDetail} />
            )}
          </div>

          <div className="agent-composer">
            <label className="field field--grow">
              <span>{copy.messageLabel}</span>
              <textarea
                value={draft}
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={copy.messagePlaceholder}
                disabled={running}
              />
            </label>
            <button className="primary-button" type="button" onClick={sendMessage} disabled={running || !draft.trim()}>
              <Send size={16} />
              {copy.send}
            </button>
            <button className="secondary-button" type="button" onClick={stop} disabled={!running}>
              <Square size={15} />
              {copy.stop}
            </button>
          </div>
        </main>

        <aside className="agent-context">
          <section className="panel">
            <div className="panel__title">
              <MessageSquareText size={17} />
              {copy.sourcesTitle}
            </div>
            {sources.length ? (
              <div className="citation-list">
                {sources.map((source) => (
                  <article className="citation-item" key={`${source.path}-${source.title ?? ""}`}>
                    <div className="citation-item__meta">
                      <span>{source.layer ?? "base"}</span>
                      {typeof source.score === "number" ? <span>{source.score.toFixed(3)}</span> : null}
                    </div>
                    <div className="citation-item__path">{source.path}</div>
                    {source.title ? <p>{source.title}</p> : null}
                    {source.excerpt ? <p>{source.excerpt}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title={copy.emptySources} />
            )}
          </section>

          <section className="panel">
            <div className="panel__title">
              <Wrench size={17} />
              {copy.toolsTitle}
            </div>
            {toolEvents.length ? (
              <div className="mini-table">
                {toolEvents.map((event) => (
                  <div className="mini-table__row" key={event.id}>
                    <span>{event.status}</span>
                    <strong>{event.name}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={copy.emptyTools} />
            )}
          </section>

          {activeSession ? (
            <button className="secondary-button secondary-button--danger" type="button" onClick={() => deleteSession(activeSession.id)}>
              <Trash2 size={16} />
              {copy.deleteSession}
            </button>
          ) : null}
        </aside>
      </section>
    </div>
  );
}

function MessageBubble({ assistantRole, message, userRole }: { assistantRole: string; message: AgentMessage; userRole: string }) {
  const isUser = message.role === "user";
  return (
    <article className={`agent-message ${isUser ? "agent-message--user" : "agent-message--assistant"}`}>
      <div className="agent-message__role">{isUser ? userRole : assistantRole}</div>
      <p>{message.content}</p>
    </article>
  );
}

function localMessage(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: `local-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

function mergeSources(items: AgentSource[], next: AgentSource): AgentSource[] {
  return items.some((item) => item.path === next.path && item.title === next.title) ? items : [...items, next];
}

function mergeTools(items: AgentToolEvent[], next: AgentToolEvent): AgentToolEvent[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...items, next];
  }
  const copy = [...items];
  copy[index] = next;
  return copy;
}

function mergeSummary(items: SessionSummary[], next: SessionSummary): SessionSummary[] {
  return [next, ...items.filter((item) => item.id !== next.id)];
}

function toSummary(session: AgentSession): SessionSummary {
  const messages = session.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    lastMessagePreview: lastMessage?.content ?? ""
  };
}
