import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PencilLine,
  Plus,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle
} from "lucide-react";
import type { DikwClient } from "../api/client";
import { AgentClient } from "../api/agentClient";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import type { AgentClientLike } from "./agentTypes";
import type { AgentMessage, AgentSession, AgentSource, AgentToolEvent, SessionSummary } from "../agent/types";

interface ChatPageProps {
  client?: DikwClient;
  agentClient?: AgentClientLike;
  locale?: Locale;
}

export function ChatPage({ agentClient, locale = "en" }: ChatPageProps) {
  const copy = translations[locale].pages.chat;
  const resolvedAgentClient = useMemo(() => agentClient ?? new AgentClient(), [agentClient]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
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
            setSelectedTurnId(null);
            setStreamingTurnId(null);
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
    setSelectedTurnId(latestAssistantTurnId(session));
    setStreamingTurnId(null);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStreamingTools([]);
  }

  async function createSession() {
    setError(null);
    const session = await resolvedAgentClient.createSession();
    setActiveSession(session);
    setSelectedTurnId(null);
    setStreamingTurnId(null);
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

  function startRename(session: SessionSummary) {
    setError(null);
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  }

  function cancelRename() {
    setEditingSessionId(null);
    setEditingTitle("");
  }

  async function saveRename(session: SessionSummary) {
    const title = editingTitle.trim();
    if (!title) {
      setError(new Error(copy.emptyTitleError));
      return;
    }
    if (title === session.title) {
      cancelRename();
      return;
    }
    setError(null);
    try {
      const renamed = await resolvedAgentClient.renameSession(session.id, title);
      setActiveSession((current) => (current?.id === renamed.id ? renamed : current));
      setSessions((items) => mergeSummary(items, toSummary(renamed)));
      cancelRename();
    } catch (nextError) {
      setError(nextError);
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
    let currentTurnId = `local-${Date.now()}`;
    setDraft("");
    setError(null);
    setRunning(true);
    setSelectedTurnId(currentTurnId);
    setStreamingTurnId(currentTurnId);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStreamingTools([]);
    setActiveSession((current) =>
      current
        ? {
            ...current,
            messages: [...(current.messages ?? []), localMessage("user", message, currentTurnId)]
          }
        : current
    );

    try {
      for await (const event of resolvedAgentClient.sendMessage(session.id, message, controller.signal)) {
        if (event.type === "message_delta") {
          setStreamingAnswer((value) => value + event.delta);
        } else if (event.type === "source") {
          currentTurnId = event.source.turnId ?? currentTurnId;
          setSelectedTurnId(currentTurnId);
          setStreamingTurnId(currentTurnId);
          setStreamingSources((value) => mergeSources(value, withTurnId(event.source, currentTurnId)));
        } else if (event.type === "tool_event") {
          currentTurnId = event.event.turnId ?? currentTurnId;
          setSelectedTurnId(currentTurnId);
          setStreamingTurnId(currentTurnId);
          setStreamingTools((value) => mergeTools(value, withTurnId(event.event, currentTurnId)));
        } else if (event.type === "error") {
          setError(new Error(event.message));
        }
      }
      const refreshed = await resolvedAgentClient.getSession(session.id);
      setActiveSession(refreshed);
      setSelectedTurnId(latestAssistantTurnId(refreshed) ?? currentTurnId);
      setSessions((items) => mergeSummary(items, toSummary(refreshed)));
      setStreamingTurnId(null);
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
  const contextTurnId = selectedTurnId ?? latestAssistantTurnId(activeSession);
  const sources = filterByTurn([...(activeSession?.sources ?? []), ...streamingSources], contextTurnId);
  const toolEvents = filterByTurn([...(activeSession?.toolEvents ?? []), ...streamingTools], contextTurnId);

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
              <div
                className={`agent-session-row ${activeSession?.id === session.id ? "is-active" : ""}`}
                key={session.id}
              >
                {editingSessionId === session.id ? (
                  <form
                    className="agent-session-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename(session);
                    }}
                  >
                    <label className="sr-only" htmlFor={`chat-title-${session.id}`}>
                      {copy.titleLabel}
                    </label>
                    <input
                      id={`chat-title-${session.id}`}
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      maxLength={80}
                      autoFocus
                    />
                    <button className="icon-button" type="submit" aria-label={copy.saveTitle}>
                      <Check size={14} />
                    </button>
                    <button className="icon-button" type="button" aria-label={copy.cancelRename} onClick={cancelRename}>
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="agent-session"
                      type="button"
                      onClick={() => openSession(session.id)}
                    >
                      <strong>{session.title}</strong>
                      <span>{session.lastMessagePreview || copy.emptySession}</span>
                    </button>
                    <button
                      className="icon-button agent-session__rename"
                      type="button"
                      aria-label={`${copy.renameSession} ${session.title}`}
                      onClick={() => startRename(session)}
                    >
                      <PencilLine size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>

        <main className="agent-workspace" aria-label={copy.chatRegion}>
          <div className="agent-conversation-scroll" data-testid="agent-conversation-scroll">
            <div className="agent-message-list">
              {messages.length || streamingAnswer ? (
                <>
                  {messages.map((message) => (
                    <MessageBubble
                      assistantRole={copy.assistantRole}
                      isSelected={Boolean(message.role === "assistant" && message.turnId && message.turnId === contextTurnId)}
                      message={message}
                      onSelect={
                        message.role === "assistant" && message.turnId ? () => setSelectedTurnId(message.turnId ?? null) : undefined
                      }
                      userRole={copy.userRole}
                      key={message.id}
                    />
                  ))}
                  {streamingAnswer ? (
                    <article
                      className={`agent-message agent-message--assistant agent-message--streaming ${
                        streamingTurnId && streamingTurnId === contextTurnId ? "agent-message--selected" : ""
                      }`}
                    >
                      <div className="agent-message__role">
                        <Loader2 size={11} className="agent-message__spinner" aria-hidden="true" />
                        {copy.assistantRole}
                      </div>
                      <MarkdownView body={streamingAnswer} showFrontmatter={false} />
                    </article>
                  ) : null}
                </>
              ) : (
                <EmptyState title={copy.emptyAnswerTitle} detail={copy.emptyAnswerDetail} />
              )}
            </div>

            <aside className="agent-context" aria-label={copy.contextTitle}>
              <div className="agent-context__heading">{copy.contextTitle}</div>
              <section className="panel">
                <div className="panel__title">
                  <MessageSquareText size={17} />
                  {copy.sourcesTitle}
                </div>
                {sources.length ? (
                  <div className="citation-list">
                    {sources.map((source) => (
                      <article className="citation-item" key={`${source.turnId ?? "turn"}-${source.path}-${source.title ?? ""}`}>
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
                  <ul className="tool-call-list" aria-label={copy.toolsTitle}>
                    {toolEvents.map((event) => (
                      <li
                        className={`tool-call tool-call--${event.status}`}
                        key={`${event.turnId ?? "turn"}-${event.id}`}
                        title={toolStatusLabel(event.status, copy)}
                      >
                        <span className="tool-call__icon" aria-hidden="true">
                          <ToolStatusIcon status={event.status} />
                        </span>
                        <span className="tool-call__name">{event.name}</span>
                        <span className="tool-call__sr">{toolStatusLabel(event.status, copy)}</span>
                      </li>
                    ))}
                  </ul>
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
      </section>
    </div>
  );
}

function MessageBubble({
  assistantRole,
  isSelected,
  message,
  onSelect,
  userRole
}: {
  assistantRole: string;
  isSelected: boolean;
  message: AgentMessage;
  onSelect?: () => void;
  userRole: string;
}) {
  const isUser = message.role === "user";
  const isSelectable = !isUser && Boolean(onSelect);
  const roleLabel = isUser ? userRole : assistantRole;
  return (
    <article
      className={`agent-message ${isUser ? "agent-message--user" : "agent-message--assistant"} ${
        isSelected ? "agent-message--selected" : ""
      }`}
    >
      <div className="agent-message__role">
        {isSelectable ? (
          <button
            className="agent-message__select"
            type="button"
            aria-pressed={isSelected}
            onClick={onSelect}
          >
            <span>{roleLabel}</span>
            <span className="sr-only">: {messagePreview(message.content)}</span>
          </button>
        ) : (
          roleLabel
        )}
      </div>
      {isUser ? <p>{message.content}</p> : <MarkdownView body={message.content} showFrontmatter={false} />}
    </article>
  );
}

function ToolStatusIcon({ status }: { status: AgentToolEvent["status"] }) {
  if (status === "running") {
    return <Loader2 size={14} className="tool-call__spin" aria-hidden="true" />;
  }
  if (status === "succeeded") {
    return <CheckCircle2 size={14} aria-hidden="true" />;
  }
  return <XCircle size={14} aria-hidden="true" />;
}

function toolStatusLabel(
  status: AgentToolEvent["status"],
  copy: (typeof translations)[Locale]["pages"]["chat"]
): string {
  if (status === "running") return copy.toolStatusRunning;
  if (status === "succeeded") return copy.toolStatusSucceeded;
  return copy.toolStatusFailed;
}

function localMessage(role: AgentMessage["role"], content: string, turnId?: string): AgentMessage {
  return {
    id: `local-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(turnId ? { turnId } : {})
  };
}

function mergeSources(items: AgentSource[], next: AgentSource): AgentSource[] {
  return items.some((item) => item.path === next.path && item.title === next.title && item.turnId === next.turnId)
    ? items
    : [...items, next];
}

function mergeTools(items: AgentToolEvent[], next: AgentToolEvent): AgentToolEvent[] {
  const index = items.findIndex((item) => item.id === next.id && item.turnId === next.turnId);
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

function latestAssistantTurnId(session: AgentSession | null): string | null {
  const messages = session?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message.turnId ?? null;
    }
  }
  return null;
}

function filterByTurn<T extends { turnId?: string }>(items: T[], turnId: string | null): T[] {
  if (!turnId) {
    return [];
  }
  return items.filter((item) => item.turnId === turnId);
}

function withTurnId<T extends { turnId?: string }>(item: T, turnId: string): T {
  if (item.turnId) {
    return item;
  }
  return { ...item, turnId };
}

function messagePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
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
