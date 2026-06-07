import {
  createEvent,
  createEventActions,
  getFunctionCalls,
  getFunctionResponses,
  isCompactedEvent,
  stringifyContent,
} from "@google/adk";
import type { DatabaseSessionService, Event, Session } from "@google/adk";
import type {
  AgentMessage,
  AgentProposal,
  AgentSession,
  AgentSource,
  AgentToolEvent,
  SessionSummary,
} from "../../src/agent/types.js";
import { validateSessionTitle } from "./sessionStore.js";
import { proposalFromTool, sourcesFromTool } from "./runtime.js";

const DEFAULT_TITLE = "New chat";

export interface AdkSessionStoreOptions {
  sessionService: DatabaseSessionService;
  appName: string;
  userId: string;
}

/**
 * Wraps ADK's DatabaseSessionService and projects ADK events into the
 * existing AgentSession DTO shape at READ time, so the chat UI sees
 * byte-identical session data regardless of the underlying store.
 *
 * Fields that listSessions must surface (title, createdAt, messageCount,
 * lastMessagePreview) are mirrored into session.state because listSessions
 * returns sessions with empty events but populated state.
 */
export class AdkSessionStore {
  private readonly sessionService: DatabaseSessionService;
  private readonly appName: string;
  private readonly userId: string;

  constructor(opts: AdkSessionStoreOptions) {
    this.sessionService = opts.sessionService;
    this.appName = opts.appName;
    this.userId = opts.userId;
  }

  async createSession(): Promise<AgentSession> {
    const session = await this.sessionService.createSession({
      appName: this.appName,
      userId: this.userId,
      state: {
        title: DEFAULT_TITLE,
        createdAt: timestamp(),
        messageCount: 0,
        lastMessagePreview: "",
      },
    });
    return projectSession(session);
  }

  async getSession(id: string): Promise<AgentSession> {
    const session = await this.loadSession(id);
    return projectSession(session);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const { sessions } = await this.sessionService.listSessions({
      appName: this.appName,
      userId: this.userId,
    });
    return sessions
      .map((session) => summaryFromState(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async renameSession(id: string, title: string): Promise<AgentSession> {
    const validated = validateSessionTitle(title);
    const session = await this.loadSession(id);
    await this.persistState(session, { title: validated });
    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<void> {
    await this.sessionService.deleteSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: id,
    });
  }

  async recordProposal(id: string, proposal: AgentProposal): Promise<AgentSession> {
    const session = await this.loadSession(id);
    const key = proposalStateKey(proposal.id);
    const prev = isRecord(session.state[key])
      ? (session.state[key] as Record<string, unknown>)
      : {};
    await this.persistState(session, {
      [key]: { ...prev, status: proposal.status, taskId: proposal.taskId },
    });
    return this.getSession(id);
  }

  async updateProposalStatus(
    id: string,
    proposalId: string,
    status: AgentProposal["status"],
  ): Promise<AgentSession> {
    const session = await this.loadSession(id);
    const key = proposalStateKey(proposalId);
    const prev = isRecord(session.state[key])
      ? (session.state[key] as Record<string, unknown>)
      : {};
    await this.persistState(session, {
      [key]: { ...prev, status },
    });
    return this.getSession(id);
  }

  async finalizeTurn(id: string): Promise<void> {
    const session = await this.loadSession(id);
    const projected = projectSession(session);
    const delta: Record<string, unknown> = {
      messageCount: projected.messages.length,
      lastMessagePreview: projected.lastMessagePreview,
    };
    const currentTitle =
      typeof session.state.title === "string" ? session.state.title : DEFAULT_TITLE;
    if (currentTitle === DEFAULT_TITLE) {
      const firstUser = projected.messages.find((message) => message.role === "user");
      if (firstUser) {
        const title = preview(firstUser.content, 40);
        if (title) {
          delta.title = title;
        }
      }
    }
    await this.persistState(session, delta);
  }

  private async loadSession(id: string): Promise<Session> {
    const session = await this.sessionService.getSession({
      appName: this.appName,
      userId: this.userId,
      sessionId: id,
    });
    if (!session) {
      throw new Error(`session ${id} not found`);
    }
    return session;
  }

  private async persistState(session: Session, stateDelta: Record<string, unknown>): Promise<void> {
    const event = createEvent({ author: "user", actions: createEventActions({ stateDelta }) });
    await this.sessionService.appendEvent({ session, event });
  }
}

function projectSession(session: Session): AgentSession {
  const events = [...session.events].sort((a, b) => a.timestamp - b.timestamp);

  const messages = projectMessages(events);
  const toolEvents = projectToolEvents(events);
  const sources = projectSources(events);
  const proposals = projectProposals(events, session.state);

  const state = session.state;
  const updatedAt = isoFromMs(session.lastUpdateTime);
  const title = typeof state.title === "string" ? state.title : DEFAULT_TITLE;
  const createdAt =
    typeof state.createdAt === "string"
      ? state.createdAt
      : events.length > 0
        ? isoFromMs(events[0].timestamp)
        : updatedAt;
  const lastMessage = messages[messages.length - 1];

  return {
    id: session.id,
    title,
    createdAt,
    updatedAt,
    messageCount: messages.length,
    lastMessagePreview: lastMessage ? preview(lastMessage.content, 80) : "",
    messages,
    toolEvents,
    sources,
    proposals,
  };
}

interface OrderedMessage extends AgentMessage {
  order: number;
}

function projectMessages(events: Event[]): AgentMessage[] {
  const collected: OrderedMessage[] = [];
  // Group agent text by invocation so all streamed deltas of one turn collapse
  // into a single assistant bubble (mirrors the old pi behavior).
  const assistantByInvocation = new Map<
    string,
    { id: string; createdAt: string; order: number; text: string[] }
  >();

  events.forEach((event, index) => {
    // Context-compaction summary events (author "system", model-role text) are
    // a prompt-building artifact, not a chat turn — never render them as bubbles.
    if (isCompactedEvent(event)) {
      return;
    }
    const text = stringifyContent(event).trim();
    if (event.author === "user") {
      if (text) {
        collected.push({
          id: event.id,
          role: "user",
          content: text,
          createdAt: isoFromMs(event.timestamp),
          order: index,
        });
      }
      return;
    }
    // Agent-authored event: accumulate any text into this invocation's assistant bubble.
    if (!text) {
      return;
    }
    const key = event.invocationId || `__no_invocation__:${index}`;
    const bucket = assistantByInvocation.get(key);
    if (bucket) {
      bucket.text.push(text);
    } else {
      assistantByInvocation.set(key, {
        id: event.id,
        createdAt: isoFromMs(event.timestamp),
        order: index,
        text: [text],
      });
    }
  });

  for (const bucket of assistantByInvocation.values()) {
    // Join with "" (no separator): the live bubble is built by concatenating
    // message_delta chunks (ChatPage: value + delta), and the old pi runner
    // persisted the same concatenation. A separator here would make the
    // persisted multi-round bubble diverge from what streamed.
    const content = bucket.text.join("").trim();
    if (!content) {
      continue;
    }
    collected.push({
      id: bucket.id,
      role: "assistant",
      content,
      createdAt: bucket.createdAt,
      order: bucket.order,
    });
  }

  return collected
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...message }) => message);
}

function projectToolEvents(events: Event[]): AgentToolEvent[] {
  const byId = new Map<string, AgentToolEvent>();
  const order: string[] = [];

  const upsert = (id: string, update: (prev: AgentToolEvent | undefined) => AgentToolEvent) => {
    if (!byId.has(id)) {
      order.push(id);
    }
    byId.set(id, update(byId.get(id)));
  };

  for (const event of events) {
    const createdAt = isoFromMs(event.timestamp);
    for (const call of getFunctionCalls(event)) {
      if (!call.id) {
        continue;
      }
      upsert(call.id, () => ({
        id: call.id as string,
        type: "tool_call",
        name: typeof call.name === "string" ? call.name : "",
        status: "running",
        createdAt,
        input: call.args,
      }));
    }
    for (const resp of getFunctionResponses(event)) {
      if (!resp.id) {
        continue;
      }
      const failed = isRecord(resp.response) && "error" in resp.response;
      upsert(resp.id, (prev) => ({
        id: resp.id as string,
        type: "tool_call",
        name: typeof resp.name === "string" ? resp.name : (prev?.name ?? ""),
        status: failed ? "failed" : "succeeded",
        createdAt: prev?.createdAt ?? createdAt,
        input: prev?.input,
        output: resp.response,
        error: failed ? String((resp.response as Record<string, unknown>).error) : undefined,
      }));
    }
  }

  return order.map((id) => byId.get(id)!).filter(Boolean);
}

function projectSources(events: Event[]): AgentSource[] {
  const sources: AgentSource[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    for (const resp of getFunctionResponses(event)) {
      if (typeof resp.name !== "string") {
        continue;
      }
      for (const source of sourcesFromTool(resp.name, resp.response)) {
        const key = `${source.path} ${source.title ?? ""} ${source.kind ?? "core"}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        sources.push(source);
      }
    }
  }
  return sources;
}

function projectProposals(events: Event[], state: Record<string, unknown>): AgentProposal[] {
  const byId = new Map<string, AgentProposal>();
  const order: string[] = [];
  for (const event of events) {
    for (const resp of getFunctionResponses(event)) {
      if (typeof resp.name !== "string" || !resp.id) {
        continue;
      }
      const proposal = proposalFromTool(resp.name, resp.response, resp.id);
      if (!proposal) {
        continue;
      }
      const override = state[proposalStateKey(resp.id)];
      if (isRecord(override)) {
        if (typeof override.status === "string") {
          proposal.status = override.status as AgentProposal["status"];
        }
        if (typeof override.taskId === "string") {
          proposal.taskId = override.taskId;
        }
      }
      if (!byId.has(proposal.id)) {
        order.push(proposal.id);
      }
      byId.set(proposal.id, proposal);
    }
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

function summaryFromState(session: Session): SessionSummary {
  const state = session.state;
  const updatedAt = isoFromMs(session.lastUpdateTime);
  return {
    id: session.id,
    title: typeof state.title === "string" ? state.title : DEFAULT_TITLE,
    createdAt: typeof state.createdAt === "string" ? state.createdAt : updatedAt,
    updatedAt,
    messageCount: typeof state.messageCount === "number" ? state.messageCount : 0,
    lastMessagePreview:
      typeof state.lastMessagePreview === "string" ? state.lastMessagePreview : "",
  };
}

function proposalStateKey(proposalId: string): string {
  return `proposal:${proposalId}`;
}

// Copied from sessionStore.ts (40/80 char preview); kept local so this module
// does not depend on a non-exported helper.
function preview(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function timestamp(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
