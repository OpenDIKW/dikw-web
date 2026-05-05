import { decodeNdjsonStream } from "./ndjson";
import type {
  ApiErrorEnvelope,
  QueryStreamEvent,
  RetrieveStreamEvent,
  TaskEvent
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

  streamQuery(
    body: { q: string; limit: number },
    signal?: AbortSignal
  ): AsyncGenerator<QueryStreamEvent> {
    return this.streamNdjson<QueryStreamEvent>("/v1/query", {
      method: "POST",
      body,
      signal
    });
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

  streamTaskEvents(
    taskId: string,
    fromSeq?: number,
    signal?: AbortSignal
  ): AsyncGenerator<TaskEvent> {
    return this.streamNdjson<TaskEvent>(`/v1/tasks/${encodeURIComponent(taskId)}/events`, {
      params: fromSeq ? { from_seq: fromSeq } : undefined,
      signal
    });
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
