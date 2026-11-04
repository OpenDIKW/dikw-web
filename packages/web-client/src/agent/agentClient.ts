import { applicationHeaders } from "../applicationHeaders.js";
import { decodeNdjsonStream } from "../core/ndjson.js";
import type {
  AgentSession,
  AgentSessionScope,
  AgentStreamEvent,
  SessionSummary,
} from "../types/agent.js";
import type { SessionTraceView } from "../types/trace.js";

export interface AgentClientOptions {
  coreUrl?: string;
  token?: string;
  /** Resolve nonsecret application headers separately for each model turn. */
  requestHeaders?: () => Record<string, string>;
  /** Explicit application transport, also used for session CRUD and aborts. */
  fetch?: typeof fetch;
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
    return this.requestJson<SessionSummary[]>("/agent/sessions", { signal });
  }

  async createSession(signal?: AbortSignal, scope?: AgentSessionScope): Promise<AgentSession> {
    return this.requestJson<AgentSession>("/agent/sessions", {
      method: "POST",
      ...(scope ? { body: JSON.stringify({ scope }) } : {}),
      signal,
    });
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<AgentSession> {
    return this.requestJson<AgentSession>(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
      signal,
    });
  }

  async getSessionTraces(sessionId: string, signal?: AbortSignal): Promise<SessionTraceView> {
    return this.requestJson<SessionTraceView>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/traces`,
      { signal },
    );
  }

  async renameSession(
    sessionId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    return this.requestJson<AgentSession>(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
      signal,
    });
  }

  async deleteSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.requestJson<void>(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal,
    });
  }

  async abort(sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.requestJson<void>(`/agent/sessions/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
      signal,
    });
  }

  async confirmProposal(
    sessionId: string,
    proposalId: string,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    return this.requestJson<AgentSession>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(proposalId)}/confirm`,
      { method: "POST", body: JSON.stringify(this.connectionPayload()), signal },
    );
  }

  async rejectProposal(
    sessionId: string,
    proposalId: string,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    return this.requestJson<AgentSession>(
      `/agent/sessions/${encodeURIComponent(sessionId)}/proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST", signal },
    );
  }

  async *sendMessage(
    sessionId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent> {
    const response = await (this.options.fetch ?? fetch)(
      `/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: {
          ...applicationHeaders(this.options.requestHeaders?.()),
          Accept: "application/x-ndjson",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, ...this.connectionPayload() }),
        signal,
      },
    );

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

  private requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return requestJson<T>(
      path,
      {
        ...init,
        headers: { ...applicationHeaders(this.options.requestHeaders?.()), ...init.headers },
      },
      this.options.fetch ?? fetch,
    );
  }

  private connectionPayload(): { coreUrl?: string; token?: string } {
    return {
      ...(this.options.coreUrl ? { coreUrl: this.options.coreUrl } : {}),
      ...(this.options.token ? { token: this.options.token } : {}),
    };
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
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
  return new AgentClientError(
    response.status,
    `http_${response.status}`,
    text || response.statusText,
  );
}
