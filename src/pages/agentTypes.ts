import type { AgentSession, AgentStreamEvent, SessionSummary } from "../agent/types";

export interface AgentClientLike {
  listSessions(signal?: AbortSignal): Promise<SessionSummary[]>;
  createSession(signal?: AbortSignal): Promise<AgentSession>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<AgentSession>;
  renameSession(sessionId: string, title: string, signal?: AbortSignal): Promise<AgentSession>;
  deleteSession(sessionId: string, signal?: AbortSignal): Promise<void>;
  abort(sessionId: string, signal?: AbortSignal): Promise<void>;
  sendMessage(sessionId: string, message: string, signal?: AbortSignal): AsyncGenerator<AgentStreamEvent>;
}
