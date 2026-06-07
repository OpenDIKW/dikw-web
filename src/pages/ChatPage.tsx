import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  Plus,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import type { DikwClient } from "../api/client";
import { AgentClient } from "../api/agentClient";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { Notice } from "../components/Notice";
import { normalizeKnowledgePath } from "../utils/knowledge-path";
import { translations, type Locale } from "../i18n";
import type { AgentClientLike } from "./agentTypes";
import type {
  AgentMessage,
  AgentSession,
  AgentSource,
  AgentToolEvent,
  SessionSummary,
} from "../agent/types";

interface ChatPageProps {
  client?: DikwClient;
  agentClient?: AgentClientLike;
  locale?: Locale;
}

type ChatScrollPanel = "conversation" | "sources" | "tools";

export function ChatPage({ agentClient, locale = "en" }: ChatPageProps) {
  const copy = translations[locale].pages.chat;
  const resolvedAgentClient = useMemo(() => agentClient ?? new AgentClient(), [agentClient]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AgentSession | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [menuOpenSessionId, setMenuOpenSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingTools, setStreamingTools] = useState<AgentToolEvent[]>([]);
  const [streamingSources, setStreamingSources] = useState<AgentSource[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const sourcesScrollRef = useRef<HTMLDivElement | null>(null);
  const toolsScrollRef = useRef<HTMLUListElement | null>(null);
  const stickToBottomRef = useRef<Record<ChatScrollPanel, boolean>>({
    conversation: true,
    sources: true,
    tools: true,
  });

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

  useEffect(() => {
    if (!menuOpenSessionId) {
      return;
    }
    function handleDocumentClick() {
      setMenuOpenSessionId(null);
    }
    function handleDocumentKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpenSessionId(null);
      }
    }
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKey);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKey);
    };
  }, [menuOpenSessionId]);

  async function openSession(sessionId: string) {
    resetStickToBottom();
    const session = await resolvedAgentClient.getSession(sessionId);
    setActiveSession(session);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStreamingTools([]);
  }

  async function createSession() {
    setError(null);
    resetStickToBottom();
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

  function startRename(session: SessionSummary) {
    setError(null);
    setMenuOpenSessionId(null);
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
    resetStickToBottom();
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
            messages: [...(current.messages ?? []), localMessage("user", message)],
          }
        : current,
    );

    let receivedAssistantDelta = false;
    let receivedError = false;
    const assistantRepliesBefore = countAssistantReplies(session);
    try {
      for await (const event of resolvedAgentClient.sendMessage(
        session.id,
        message,
        controller.signal,
      )) {
        if (event.type === "message_delta") {
          receivedAssistantDelta = true;
          setStreamingAnswer((value) => value + event.delta);
        } else if (event.type === "source") {
          setStreamingSources((value) => mergeSources(value, event.source));
        } else if (event.type === "tool_event") {
          setStreamingTools((value) => mergeTools(value, event.event));
        } else if (event.type === "error") {
          receivedError = true;
          setError(new Error(event.message));
        }
      }
      const refreshed = await resolvedAgentClient.getSession(session.id);
      setActiveSession(refreshed);
      setSessions((items) => mergeSummary(items, toSummary(refreshed)));
      setStreamingAnswer("");
      setStreamingSources([]);
      setStreamingTools([]);
      if (
        !receivedError &&
        !receivedAssistantDelta &&
        countAssistantReplies(refreshed) <= assistantRepliesBefore
      ) {
        setError(new Error(copy.noResponseError));
      }
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
  // Dedup the full source list (persisted session base + this turn's stream)
  // via mergeSources so the same page isn't rendered twice — whether it recurs
  // across turns or appears under both the legacy `wiki/` and current
  // `knowledge/` prefixes in a session that spans dikw-core's 0.4.0 rename.
  // Dedup and the right-rail React key both key on the normalized path + title
  // + kind, so a normalized-equal pair can't collide.
  const sources = [...(activeSession?.sources ?? []), ...streamingSources].reduce<AgentSource[]>(
    (acc, next) => mergeSources(acc, next),
    [],
  );
  const toolEvents = [...(activeSession?.toolEvents ?? []), ...streamingTools];

  useLayoutEffect(() => {
    if (stickToBottomRef.current.conversation) {
      scrollToBottom(conversationScrollRef.current);
    }
  }, [activeSession?.id, messages.length, streamingAnswer, running]);

  useLayoutEffect(() => {
    if (stickToBottomRef.current.sources) {
      scrollToBottom(sourcesScrollRef.current);
    }
  }, [activeSession?.id, sources.length]);

  useLayoutEffect(() => {
    if (stickToBottomRef.current.tools) {
      scrollToBottom(toolsScrollRef.current);
    }
  }, [activeSession?.id, toolEvents.length]);

  function resetStickToBottom() {
    stickToBottomRef.current = {
      conversation: true,
      sources: true,
      tools: true,
    };
  }

  function trackStickToBottom(panel: ChatScrollPanel, element: HTMLElement) {
    stickToBottomRef.current = {
      ...stickToBottomRef.current,
      [panel]: isNearBottom(element),
    };
  }

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
            <button
              className="icon-button"
              type="button"
              aria-label={copy.newSession}
              onClick={createSession}
            >
              <Plus size={16} />
            </button>
          </div>
          {loading ? <EmptyState title={copy.loadingSessions} /> : null}
          <div className="agent-session-list">
            {sessions.map((session) => (
              <div
                className={`agent-session-row ${activeSession?.id === session.id ? "is-active" : ""} ${
                  menuOpenSessionId === session.id ? "has-menu-open" : ""
                }`}
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
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={copy.cancelRename}
                      onClick={cancelRename}
                    >
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
                      className="icon-button agent-session__menu-trigger"
                      type="button"
                      aria-label={`${session.title} options`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpenSessionId === session.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpenSessionId((current) =>
                          current === session.id ? null : session.id,
                        );
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {menuOpenSessionId === session.id ? (
                      <div
                        className="agent-session-menu"
                        role="menu"
                        aria-label={`${session.title} menu`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          className="agent-session-menu__item"
                          role="menuitem"
                          type="button"
                          onClick={() => startRename(session)}
                        >
                          <PencilLine size={13} />
                          <span>{copy.renameSession}</span>
                        </button>
                        <button
                          className="agent-session-menu__item agent-session-menu__item--danger"
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setMenuOpenSessionId(null);
                            void deleteSession(session.id);
                          }}
                        >
                          <Trash2 size={13} />
                          <span>{copy.deleteSession}</span>
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>

        <main className="agent-workspace" aria-label={copy.chatRegion}>
          <div
            className="agent-conversation-scroll"
            data-testid="agent-conversation-scroll"
            ref={conversationScrollRef}
            onScroll={(event) => trackStickToBottom("conversation", event.currentTarget)}
          >
            <div className="agent-message-list">
              {messages.length || streamingAnswer ? (
                <>
                  {messages.map((message) => (
                    <MessageBubble
                      assistantRole={copy.assistantRole}
                      message={message}
                      userRole={copy.userRole}
                      key={message.id}
                    />
                  ))}
                  {streamingAnswer ? (
                    <article className="agent-message agent-message--assistant agent-message--streaming">
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
          </div>

          <aside className="agent-context" aria-label={copy.contextTitle}>
            <div className="agent-context__heading">{copy.contextTitle}</div>
            <section className="panel">
              <div className="panel__title">
                <MessageSquareText size={17} />
                {copy.sourcesTitle}
              </div>
              {sources.length ? (
                <div
                  className="citation-list"
                  ref={sourcesScrollRef}
                  onScroll={(event) => trackStickToBottom("sources", event.currentTarget)}
                >
                  {sources.map((source) => {
                    const isWeb = source.kind === "web";
                    // Legacy sessions persisted before dikw-core's wiki/ -> knowledge/
                    // rename still carry wiki/ core paths and a "wiki" layer; normalize
                    // both for display (the K layer was renamed in the same change).
                    const displayPath = isWeb ? source.path : normalizeKnowledgePath(source.path);
                    const displayLayer =
                      source.layer === "wiki" ? "knowledge" : (source.layer ?? "base");
                    const safeHref = isWeb && isSafeBrowserWebUrl(source.path) ? source.path : null;
                    return (
                      <article
                        className={`citation-item${isWeb ? " citation-item--web" : ""}`}
                        key={`${source.kind ?? "core"}-${displayPath}-${source.title ?? ""}`}
                      >
                        <div className="citation-item__meta">
                          <span>{isWeb ? copy.sourcesWebBadge : displayLayer}</span>
                          {typeof source.score === "number" ? (
                            <span>{source.score.toFixed(3)}</span>
                          ) : null}
                        </div>
                        <div className="citation-item__path">
                          {safeHref ? (
                            <a href={safeHref} target="_blank" rel="noopener noreferrer">
                              {safeHref}
                            </a>
                          ) : (
                            displayPath
                          )}
                        </div>
                        {source.title ? <p>{source.title}</p> : null}
                        {source.excerpt ? <p>{source.excerpt}</p> : null}
                      </article>
                    );
                  })}
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
                <ul
                  className="tool-call-list"
                  aria-label={copy.toolsTitle}
                  ref={toolsScrollRef}
                  onScroll={(event) => trackStickToBottom("tools", event.currentTarget)}
                >
                  {toolEvents.map((event) => (
                    <li
                      className={`tool-call tool-call--${event.status}`}
                      key={event.id}
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
          </aside>

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
            <button
              className="primary-button"
              type="button"
              onClick={sendMessage}
              disabled={running || !draft.trim()}
            >
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
  message,
  userRole,
}: {
  assistantRole: string;
  message: AgentMessage;
  userRole: string;
}) {
  const isUser = message.role === "user";
  const roleLabel = isUser ? userRole : assistantRole;
  return (
    <article
      className={`agent-message ${isUser ? "agent-message--user" : "agent-message--assistant"}`}
    >
      <div className="agent-message__role">{roleLabel}</div>
      {isUser ? (
        <p>{message.content}</p>
      ) : (
        <MarkdownView body={message.content} showFrontmatter={false} />
      )}
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
  copy: (typeof translations)[Locale]["pages"]["chat"],
): string {
  if (status === "running") return copy.toolStatusRunning;
  if (status === "succeeded") return copy.toolStatusSucceeded;
  return copy.toolStatusFailed;
}

function localMessage(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: `local-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function mergeSources(items: AgentSource[], next: AgentSource): AgentSource[] {
  const nextKind = next.kind ?? "core";
  const nextPath = normalizeKnowledgePath(next.path);
  return items.some(
    (item) =>
      normalizeKnowledgePath(item.path) === nextPath &&
      (item.title ?? "") === (next.title ?? "") &&
      (item.kind ?? "core") === nextKind,
  )
    ? items
    : [...items, next];
}

export function isSafeBrowserWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^(127|10|0)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host === "::" ||
    host.startsWith("[::ffff:") ||
    host.startsWith("::ffff:")
  ) {
    return false;
  }
  return true;
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

function isNearBottom(element: HTMLElement, threshold = 24): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function scrollToBottom(element: HTMLElement | null): void {
  if (!element) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

function mergeSummary(items: SessionSummary[], next: SessionSummary): SessionSummary[] {
  return [next, ...items.filter((item) => item.id !== next.id)];
}

function countAssistantReplies(session: AgentSession): number {
  return (session.messages ?? []).filter((message) => message.role === "assistant").length;
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
    lastMessagePreview: lastMessage?.content ?? "",
  };
}
