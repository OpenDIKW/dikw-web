import type { Layer } from "../types.js";

export type AgentMessageRole = "user" | "assistant";
export type AgentProposalStatus = "pending" | "confirmed" | "rejected" | "running" | "succeeded" | "failed";
export type AgentMaintenanceAction = "ingest" | "synth" | "lint_propose";

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

export type AgentSourceKind = "core" | "web";

export interface AgentSource {
  path: string;
  title?: string | null;
  layer?: Layer | string | null;
  excerpt?: string | null;
  score?: number | null;
  kind?: AgentSourceKind;
}

export interface AgentToolEvent {
  id: string;
  type: "tool_call";
  name: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface AgentProposal {
  id: string;
  action: AgentMaintenanceAction;
  title: string;
  description: string;
  status: AgentProposalStatus;
  params?: Record<string, unknown>;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface AgentSession extends SessionSummary {
  messages: AgentMessage[];
  toolEvents: AgentToolEvent[];
  sources: AgentSource[];
  proposals: AgentProposal[];
}

export type AgentStreamEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "message_delta"; sessionId: string; delta: string }
  | { type: "tool_event"; sessionId: string; event: AgentToolEvent }
  | { type: "source"; sessionId: string; source: AgentSource }
  | { type: "proposal"; sessionId: string; proposal: AgentProposal }
  | { type: "error"; sessionId: string; code: string; message: string }
  | { type: "agent_end"; sessionId: string };
