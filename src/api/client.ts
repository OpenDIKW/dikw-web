import { decodeNdjsonStream } from "./ndjson";
import type {
  ApiErrorEnvelope,
  EventsPage,
  ImportResponse,
  LintKind,
  RetrieveStreamEvent,
  TaskEvent,
  TaskHandle,
  TaskListPage,
  TaskRow,
  TaskStatus,
} from "../types";

export interface DikwClientConfig {
  baseUrl?: string;
  token?: string;
  /** Stable identifier for the core this client talks to — used by callers
   *  that persist task state and must invalidate it if the user reconnects to
   *  a different server. Defaults to ``baseUrl`` when omitted, which collapses
   *  to the empty string in same-origin proxy mode; pass an explicit value
   *  (e.g. the user-visible server URL) to distinguish proxy targets. */
  coreId?: string;
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
  private readonly _coreId: string;

  constructor(config: DikwClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "");
    this.token = config.token ?? "";
    // Default to the normalized baseUrl, but allow callers to override —
    // e.g. App.tsx passes the user-visible ``serverUrl`` so the same-origin
    // proxy mode (baseUrl='') still has a distinct identity across distinct
    // upstream cores.
    this._coreId = normalizeBaseUrl(config.coreId ?? config.baseUrl ?? "");
  }

  /** Stable identifier for the core this client talks to. Used by callers that
   *  persist task state and must invalidate it if the user reconnects to a
   *  different server. */
  get coreId(): string {
    return this._coreId;
  }

  get<T>(path: string, options: Omit<JsonRequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: "GET" });
  }

  post<T>(
    path: string,
    body?: unknown,
    options: Omit<JsonRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return this.requestJson<T>(path, { ...options, method: "POST", body });
  }

  listTasks(
    params: { status?: TaskStatus; op?: string; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ): Promise<TaskListPage> {
    return this.requestJson<TaskListPage>("/v1/tasks", {
      method: "GET",
      params: {
        status: params.status,
        op: params.op,
        limit: params.limit,
        cursor: params.cursor,
      },
      signal,
    });
  }

  getTask(taskId: string, signal?: AbortSignal): Promise<TaskRow> {
    return this.requestJson<TaskRow>(`/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      signal,
    });
  }

  async getTaskResult<T = Record<string, unknown>>(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<T> {
    // ``GET /v1/tasks/{id}/result`` returns a ``TaskResultBody`` envelope
    // ``{ task_id, status, started_at, finished_at, result, error }``. Every
    // caller wants the unwrapped ``result`` payload (e.g. ``FixProposalReport``
    // / ``ApplyReport``) and would otherwise read ``proposeResult.proposals``
    // off the envelope and get ``undefined``. Unwrap centrally so each caller
    // doesn't have to remember.
    const envelope = await this.requestJson<{
      task_id: string;
      status: TaskStatus;
      result: T | null;
      error: Record<string, unknown> | null;
    }>(`/v1/tasks/${encodeURIComponent(taskId)}/result`, {
      method: "GET",
      signal,
    });
    if (envelope.status !== "succeeded") {
      // Use a distinct ``code`` for cancelled vs failed so callers (notably
      // ImportPage.handlePipelineError) can route a server-cancelled task to
      // the cancelled UI branch instead of treating it as a generic failure.
      throw new DikwClientError({
        status: 200,
        code: envelope.status === "cancelled" ? "task_cancelled" : "task_not_succeeded",
        message: `task ${taskId} terminated as ${envelope.status}; cannot return result`,
        detail: envelope.error ?? undefined,
      });
    }
    if (envelope.result === null) {
      throw new DikwClientError({
        status: 200,
        code: "task_result_empty",
        message: `task ${taskId} succeeded but recorded no result`,
      });
    }
    return envelope.result;
  }

  /**
   * Authoritative terminal verdict for a task, shaped as a synthetic
   * ``type:"final"`` event. ``streamTaskEvents`` decides *when to stop polling*
   * from ``task_status`` + ``has_more``, but pipeline callers read *success*
   * from a captured ``final`` event. Those two signals can disagree within a
   * single ``/events`` response: ``task_status`` is read live (already
   * terminal) while the ``events[]`` tail lags, so a page can report
   * ``{task_status:"succeeded", has_more:false, events:[]}`` and the stream
   * ends without ever yielding the ``final`` event. ``GET /v1/tasks/{id}``
   * reads the authoritative row (the same source the Tasks list shows), so it
   * never loses that race — use it to reconcile when the stream drained without
   * a ``final``. Returns ``null`` if the task is somehow still non-terminal.
   */
  async getTaskFinalEvent(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<Extract<TaskEvent, { type: "final" }> | null> {
    const row = await this.getTask(taskId, signal);
    if (!isTerminalStatus(row.status)) {
      return null;
    }
    return {
      type: "final",
      seq: -1,
      ts: row.finished_at ?? row.created_at,
      status: row.status,
      result: row.result,
      error: row.error,
    };
  }

  cancelTask(taskId: string, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson<unknown>(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      signal,
    });
  }

  importBundle(payload: Blob, manifestJson: string, signal?: AbortSignal): Promise<ImportResponse> {
    const form = new FormData();
    // Field names match dikw-core's routes_import.py multipart contract.
    form.append("payload", payload, "import.tar.gz");
    form.append("manifest", manifestJson);
    return this.postMultipart<ImportResponse>("/v1/import", form, signal);
  }

  startIngest(opts: { noEmbed?: boolean } = {}, signal?: AbortSignal): Promise<TaskHandle> {
    return this.post<TaskHandle>("/v1/ingest", { no_embed: opts.noEmbed ?? false }, { signal });
  }

  startSynth(
    opts: { forceAll?: boolean; noEmbed?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<TaskHandle> {
    return this.post<TaskHandle>(
      "/v1/synth",
      { force_all: opts.forceAll ?? false, no_embed: opts.noEmbed ?? false },
      { signal },
    );
  }

  startLintPropose(
    opts: { rule?: LintKind | null; limit?: number; enableLlm?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<TaskHandle> {
    return this.post<TaskHandle>(
      "/v1/lint/propose",
      {
        rule: opts.rule ?? null,
        limit: opts.limit ?? 10,
        enable_llm: opts.enableLlm ?? false,
      },
      { signal },
    );
  }

  startLintApply(
    opts: {
      proposalTaskId: string;
      pick?: number[] | null;
      skip?: number[] | null;
    },
    signal?: AbortSignal,
  ): Promise<TaskHandle> {
    return this.post<TaskHandle>(
      "/v1/lint/apply",
      {
        proposal_task_id: opts.proposalTaskId,
        pick: opts.pick ?? null,
        skip: opts.skip ?? null,
      },
      { signal },
    );
  }

  async postMultipart<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
    // FormData sets its own Content-Type with boundary — never inject one.
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(buildRequestUrl(this.baseUrl, path), {
      method: "POST",
      headers,
      body: form,
      signal,
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
    const response = await fetch(buildRequestUrl(this.baseUrl, path, options.params), {
      method: options.method ?? "GET",
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
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
    signal?: AbortSignal,
  ): AsyncGenerator<RetrieveStreamEvent> {
    return this.streamNdjson<RetrieveStreamEvent>("/v1/retrieve", {
      method: "POST",
      body,
      signal,
    });
  }

  async *streamTaskEvents(
    taskId: string,
    fromSeq?: number,
    signal?: AbortSignal,
  ): AsyncGenerator<TaskEvent> {
    const path = `/v1/tasks/${encodeURIComponent(taskId)}/events`;
    let cursor = fromSeq;
    let failures = 0;

    while (true) {
      let page: EventsPage;
      try {
        page = await this.requestJson<EventsPage>(path, {
          method: "GET",
          params: { from_seq: cursor, wait: 30 },
          signal,
        });
        failures = 0;
      } catch (error) {
        // A long follow can sit behind a proxy/tunnel that transiently drops or
        // 5xx's the connection. The poll is resumable from the unchanged
        // ``cursor`` (advanced only after a successful page below), so a
        // transient gateway/network failure should reconnect rather than abort
        // the follow. Cancellation and non-transient errors (4xx) propagate.
        if (signal?.aborted || !isRetryableFollowError(error)) {
          throw error;
        }
        failures += 1;
        if (failures > FOLLOW_MAX_RETRIES) {
          throw error;
        }
        await abortableDelay(followBackoffMs(failures), signal);
        continue;
      }

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
      signal: options.signal,
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (!response.body) {
      throw new DikwClientError({
        status: response.status,
        code: "empty_stream",
        message: "Server returned an empty stream body",
      });
    }

    for await (const event of decodeNdjsonStream(response.body)) {
      if (!isRecord(event)) {
        throw new DikwClientError({
          status: response.status,
          code: "invalid_ndjson",
          message: "NDJSON event is not a JSON object",
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
      Accept: "application/json, application/x-ndjson",
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
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = baseUrl === "" ? new URL(normalizedPath, origin) : new URL(normalizedPath, baseUrl);

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
      detail: envelope.error.detail,
    });
  }
  return new DikwClientError({
    status: response.status,
    code: `http_${response.status}`,
    message: text.slice(0, 240) || response.statusText,
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
        detail: isRecord(detail) ? detail : undefined,
      },
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalStatus(status: TaskStatus): status is "succeeded" | "failed" | "cancelled" {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

// ── task-follow transient-error resilience ──────────────────────────────────
// ``streamTaskEvents`` long-polls ``GET /v1/tasks/{id}/events`` and is resumable
// from the last ``from_seq`` cursor (advanced only after a successful page). A
// reverse proxy / tunnel (Cloudflare, nginx, Caddy) can drop or 5xx a long-lived
// connection mid-task while the task keeps running server-side, so a transient
// poll failure should reconnect — not abort the follow and misreport a running
// task as failed.
const FOLLOW_RETRY_BASE_MS = 1000;
const FOLLOW_RETRY_CAP_MS = 15000;
const FOLLOW_MAX_RETRIES = 8;

/** Capped exponential backoff: 1s, 2s, 4s, 8s, 15s, 15s… (``attempt`` is 1-based,
 *  the count of consecutive failures). */
function followBackoffMs(attempt: number): number {
  return Math.min(FOLLOW_RETRY_BASE_MS * 2 ** (attempt - 1), FOLLOW_RETRY_CAP_MS);
}

/** Transient transport failures worth reconnecting on: upstream 5xx (502/503/504
 *  from a proxy/tunnel) and network-level fetch failures (``TypeError``). Client
 *  errors (4xx, incl. auth/404) and aborts are NOT retried. */
function isRetryableFollowError(error: unknown): boolean {
  if (error instanceof DikwClientError) {
    return error.status >= 500;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  return error instanceof TypeError;
}

/** ``setTimeout`` as a promise that rejects with ``AbortError`` the moment the
 *  signal fires, so a cancel during backoff exits promptly instead of waiting
 *  out the full delay. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
