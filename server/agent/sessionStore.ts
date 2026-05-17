import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentProposal, AgentSession, AgentSource, AgentToolEvent, SessionSummary } from "../../src/agent/types";

export class FileSessionStore {
  constructor(private readonly root: string) {}

  async createSession(): Promise<AgentSession> {
    const now = timestamp();
    const session: AgentSession = {
      id: randomUUID(),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessagePreview: "",
      messages: [],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    await this.writeSession(session);
    return session;
  }

  async listSessions(): Promise<SessionSummary[]> {
    await mkdir(this.root, { recursive: true });
    const files = await readdir(this.root);
    const summaries: SessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const session = await this.readSessionFile(file);
        summaries.push(toSummary(session));
      } catch {
        // Ignore unreadable session files; opening by id will still report a precise error.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id: string): Promise<AgentSession> {
    return this.readSessionFile(`${safeId(id)}.json`);
  }

  async deleteSession(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  async renameSession(id: string, title: string): Promise<AgentSession> {
    const session = await this.getSession(id);
    session.title = validateSessionTitle(title);
    return this.touchAndWrite(session);
  }

  async appendUserMessage(id: string, content: string): Promise<AgentSession> {
    return this.appendMessage(id, "user", content);
  }

  async appendAssistantMessage(id: string, content: string): Promise<AgentSession> {
    return this.appendMessage(id, "assistant", content);
  }

  async recordToolEvent(id: string, event: AgentToolEvent): Promise<AgentSession> {
    const session = await this.getSession(id);
    const index = session.toolEvents.findIndex((item) => item.id === event.id);
    if (index === -1) {
      session.toolEvents.push(event);
    } else {
      session.toolEvents[index] = event;
    }
    return this.touchAndWrite(session);
  }

  async recordSource(id: string, source: AgentSource): Promise<AgentSession> {
    const session = await this.getSession(id);
    const incomingKind = source.kind ?? "core";
    if (
      !session.sources.some(
        (item) => item.path === source.path && item.title === source.title && (item.kind ?? "core") === incomingKind
      )
    ) {
      session.sources.push(source);
    }
    return this.touchAndWrite(session);
  }

  async recordProposal(id: string, proposal: AgentProposal): Promise<AgentSession> {
    const session = await this.getSession(id);
    const index = session.proposals.findIndex((item) => item.id === proposal.id);
    if (index === -1) {
      session.proposals.push(proposal);
    } else {
      session.proposals[index] = proposal;
    }
    return this.touchAndWrite(session);
  }

  async updateProposalStatus(id: string, proposalId: string, status: AgentProposal["status"]): Promise<AgentSession> {
    const session = await this.getSession(id);
    const proposal = session.proposals.find((item) => item.id === proposalId);
    if (!proposal) {
      throw new Error(`proposal ${proposalId} not found`);
    }
    proposal.status = status;
    proposal.updatedAt = timestamp();
    return this.touchAndWrite(session);
  }

  private async appendMessage(id: string, role: AgentMessage["role"], content: string): Promise<AgentSession> {
    const session = await this.getSession(id);
    session.messages.push({
      id: randomUUID(),
      role,
      content,
      createdAt: timestamp()
    });
    if (role === "user" && session.title === "New chat") {
      session.title = preview(content, 40) || "New chat";
    }
    return this.touchAndWrite(session);
  }

  private async readSessionFile(file: string): Promise<AgentSession> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(this.root, file), "utf8"));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`session ${file.replace(/\.json$/, "")} not found`);
      }
      throw error;
    }
    return normalizeSession(parsed);
  }

  private async touchAndWrite(session: AgentSession): Promise<AgentSession> {
    session.updatedAt = timestamp();
    const summary = toSummary(session);
    Object.assign(session, summary);
    await this.writeSession(session);
    return session;
  }

  private async writeSession(session: AgentSession): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const target = this.pathFor(session.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  private pathFor(id: string): string {
    return join(this.root, `${safeId(id)}.json`);
  }
}

function normalizeSession(value: unknown): AgentSession {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("invalid session file");
  }
  const session: AgentSession = {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "New chat",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp(),
    messageCount: 0,
    lastMessagePreview: "",
    messages: Array.isArray(value.messages) ? (value.messages as AgentMessage[]) : [],
    toolEvents: Array.isArray(value.toolEvents) ? (value.toolEvents as AgentToolEvent[]) : [],
    sources: Array.isArray(value.sources) ? (value.sources as AgentSource[]) : [],
    proposals: Array.isArray(value.proposals) ? (value.proposals as AgentProposal[]) : []
  };
  return { ...session, ...toSummary(session) };
}

function toSummary(session: AgentSession): SessionSummary {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title || "New chat",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage ? preview(lastMessage.content, 80) : ""
  };
}

function preview(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

export type SessionTitleParseResult =
  | { ok: true; title: string }
  | { ok: false; reason: "required" | "too_long" };

export function parseSessionTitle(value: unknown): SessionTitleParseResult {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: "required" };
  }
  const title = value.trim();
  if (title.length > 80) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, title };
}

export const SESSION_TITLE_ERROR_MESSAGES: Record<"required" | "too_long", string> = {
  required: "session title is required",
  too_long: "session title is too long"
};

export function validateSessionTitle(value: unknown): string {
  const result = parseSessionTitle(value);
  if (!result.ok) {
    throw new Error(SESSION_TITLE_ERROR_MESSAGES[result.reason]);
  }
  return result.title;
}

function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("invalid session id");
  }
  return id;
}

function timestamp(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
