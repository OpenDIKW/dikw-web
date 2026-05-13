import { decodeNdjsonStream } from "./ndjson";
import type { AgentSession, AgentStreamEvent, SessionSummary } from "../agent/types";

export interface AgentClientOptions {
  coreUrl?: string;
  token?: string;
}

export class AgentClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentClientError";
    this.status = status;
    this.code = code;
  }
}

export class AgentClient {
  constructor(private readonly options: AgentClientOptions = {}) {}

  async listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
    return requestJson<SessionSummary[]>("/agent/sessions", { signal });
  }

  async createSession(signal?: AbortSignal): Promise<AgentSession> {
    return requestJson<AgentSession>("/agent/sessions", { method: "POST", signal });
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<AgentSession> {
    return requestJson<AgentSession>(`/agent/sessions/${encodeURIComponent(sessionId)}`, { signal });
  }

  async deleteSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    await requestJson<void>(`/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", signal });
  }

  async abort(sessionId: string, signal?: AbortSignal): Promise<void> {
    await requestJson<void>(`/agent/sessions/${encodeURIComponent(sessionId)}/abort`, { method: "POST", signal });
  }

  async confirmProposal(sessionId: string, proposalId: string, signal?: AbortSignal): Promise<AgentSession> {
    return requestJson<AgentSession>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(proposalId)}/confirm`,
      { method: "POST", body: JSON.stringify(this.connectionPayload()), signal }
    );
  }

  async rejectProposal(sessionId: string, proposalId: string, signal?: AbortSignal): Promise<AgentSession> {
    return requestJson<AgentSession>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST", signal }
    );
  }

  async *sendMessage(sessionId: string, message: string, signal?: AbortSignal): AsyncGenerator<AgentStreamEvent> {
    const response = await fetch(`/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message, ...this.connectionPayload() }),
      signal
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    if (!response.body) {
      throw new AgentClientError(response.status, "empty_stream", "Agent returned an empty stream");
    }
    for await (const event of decodeNdjsonStream(response.body)) {
      yield event as AgentStreamEvent;
    }
  }

  private connectionPayload(): { coreUrl?: string; token?: string } {
    return {
      ...(this.options.coreUrl ? { coreUrl: this.options.coreUrl } : {}),
      ...(this.options.token ? { token: this.options.token } : {})
    };
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function errorFromResponse(response: Response): Promise<AgentClientError> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.code && parsed.error.message) {
      return new AgentClientError(response.status, parsed.error.code, parsed.error.message);
    }
  } catch {
    // fall through to plain text
  }
  return new AgentClientError(response.status, `http_${response.status}`, text || response.statusText);
}
