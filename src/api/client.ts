import { decodeNdjsonStream } from "./ndjson";
import type {
  ApiErrorEnvelope,
  EventsPage,
  RetrieveStreamEvent,
  TaskEvent,
  TaskListPage,
  TaskRow,
  TaskStatus
} from "../types";

export interface DikwClientConfig {
  baseUrl?: string;
  token?: string;
}

export interface JsonRequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export class DikwClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "DikwClientError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
  }
}

export class DikwClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: DikwClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "");
    this.token = config.token ?? "";
  }

  get<T>(
    path: string,
    options: Omit<JsonRequestOptions, "method" | "body"> = {}
  ): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: "GET" });
  }

  post<T>(
    path: string,
    body?: unknown,
    options: Omit<JsonRequestOptions, "method" | "body"> = {}
  ): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: "POST", body });
  }

  listTasks(
    params: { status?: TaskStatus; op?: string; limit?: number; cursor?: string } = {},
    signal?: AbortSignal
  ): Promise<TaskListPage> {
    return this.requestJson<TaskListPage>("/v1/tasks", {
      method: "GET",
      params: {
        status: params.status,
        op: params.op,
        limit: params.limit,
        cursor: params.cursor
      },
      signal
    });
  }

  getTask(taskId: string, signal?: AbortSignal): Promise<TaskRow> {
    return this.requestJson<TaskRow>(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      signal
    });
  }

  async requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
    const response = await fetch(buildRequestUrl(this.baseUrl, path, options.params), {
      method: options.method ?? "GET",
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  streamRetrieve(
    body: { q: string; limit: number },
    signal?: AbortSignal
  ): AsyncGenerator<RetrieveStreamEvent> {
    return this.streamNdjson<RetrieveStreamEvent>("/v1/retrieve", {
      method: "POST",
      body,
      signal
    });
  }

  async *streamTaskEvents(
    taskId: string,
    fromSeq?: number,
    signal?: AbortSignal
  ): AsyncGenerator<TaskEvent> {
    const path = `/v1/tasks/${encodeURIComponent(taskId)}/events`;
    let cursor = fromSeq;

    while (true) {
      const page = await this.requestJson<EventsPage>(path, {
        method: "GET",
        params: { from_seq: cursor, wait: 30 },
        signal
      });

      for (const event of page.events) {
        yield event;
      }

      cursor = page.next_from_seq;

      if (!page.has_more && isTerminalStatus(page.task_status)) {
        return;
      }
    }
  }

  async *streamNdjson<T>(path: string, options: JsonRequestOptions = {}): AsyncGenerator<T> {
    const response = await fetch(buildRequestUrl(this.baseUrl, path, options.params), {
      method: options.method ?? "GET",
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (!response.body) {
      throw new DikwClientError({
        status: response.status,
        code: "empty_stream",
        message: "Server returned an empty stream body"
      });
    }

    for await (const event of decodeNdjsonStream(response.body)) {
      if (!isRecord(event)) {
        throw new DikwClientError({
          status: response.status,
          code: "invalid_ndjson",
          message: "NDJSON event is not a JSON object"
        });
      }
      if (event.type === "heartbeat") {
        continue;
      }
      yield event as T;
    }
  }

  private headers(hasJsonBody: boolean): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json, application/x-ndjson"
    };
    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}

export function buildRequestUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url =
    baseUrl === ""
      ? new URL(normalizedPath, origin)
      : new URL(normalizedPath, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  if (baseUrl === "") {
    return `${url.pathname}${url.search}`;
  }
  return url.toString();
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function errorFromResponse(response: Response): Promise<DikwClientError> {
  const text = await response.text();
  const envelope = parseErrorEnvelope(text);
  if (envelope) {
    return new DikwClientError({
      status: response.status,
      code: envelope.error.code,
      message: envelope.error.message,
      detail: envelope.error.detail
    });
  }
  return new DikwClientError({
    status: response.status,
    code: `http_${response.status}`,
    message: text.slice(0, 240) || response.statusText
  });
}

function parseErrorEnvelope(text: string): ApiErrorEnvelope | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.error)) {
      return null;
    }
    const { code, message, detail } = parsed.error;
    if (typeof code !== "string" || typeof message !== "string") {
      return null;
    }
    return {
      error: {
        code,
        message,
        detail: isRecord(detail) ? detail : undefined
      }
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
