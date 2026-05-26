// MinerU v4 batch API HTTP client. Ported behavior-for-behavior from
// dikw-plugins/packages/dikw-converter-mineru/_client.py — retry budget,
// error-code classification, OSS PUT without Content-Type, token redaction.
//
// Differences from Python:
//   * Node 24's global ``fetch`` instead of httpx (injected via ``fetch``
//     option for test doubles).
//   * Async ``sleep`` so we never block the event loop in tests.
//   * ``now``/``sleep`` injection for deterministic timing tests.

const API_BASE = "https://mineru.net/api/v4";
const SUBMIT_URL = `${API_BASE}/file-urls/batch`;
const RESULT_URL = (batchId: string): string =>
  `${API_BASE}/extract-results/batch/${encodeURIComponent(batchId)}`;

const POLL_INITIAL_MS = 2_000;
const POLL_MAX_MS = 30_000;
const POLL_BACKOFF_FACTOR = 1.5;
const POLL_TOTAL_TIMEOUT_MS = 600_000;

const RETRY_ATTEMPTS = 3;
const RETRY_INITIAL_BACKOFF_MS = 1_000;

const MAX_ZIP_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const CACHE_TOLERANCE_SEC = 31_536_000;

const STATE_DONE = "done";
const STATE_FAILED = "failed";

const AUTH_CODES = new Set(["A0202", "A0211"]);
const INPUT_CODES = new Set([
  "-60002",
  "-60005",
  "-60006",
  "-30001",
  "-30002",
  "-30003"
]);
const QUOTA_CODES = new Set(["-60018", "-60019"]);

export type MineruErrorCode =
  | "mineru_auth"
  | "mineru_input"
  | "mineru_quota"
  | "mineru_timeout"
  | "mineru_api";

export class MineruClientError extends Error {
  readonly code: MineruErrorCode;
  constructor(code: MineruErrorCode, message: string) {
    super(message);
    this.name = "MineruClientError";
    this.code = code;
  }
}

export type MineruFetch = (
  url: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface SubmitParams {
  fileName: string;
  /** Deterministic id MinerU keys its 1-year cache off. Take the first 32
   *  chars of the input SHA-256 (MinerU's data_id field is capped). */
  dataId: string;
  language?: string;
  /** "vlm" for PDFs (per Python plugin). Omit for Office formats so MinerU
   *  picks the right pipeline. */
  modelVersion?: string | null;
  enableTable?: boolean;
  enableFormula?: boolean;
  isOcr?: boolean;
}

export interface SubmissionHandle {
  batchId: string;
  uploadUrl: string;
}

export interface MineruClientOptions {
  token: string;
  fetch?: MineruFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollInitialMs?: number;
  pollMaxMs?: number;
  pollTotalTimeoutMs?: number;
  signal?: AbortSignal;
}

function redact(token: string): string {
  if (!token) return "";
  return `…${token.slice(-4)}`;
}

function scrub(message: string, token: string): string {
  if (!token) return message;
  if (!message.includes(token)) return message;
  return message.split(token).join(redact(token));
}

function classify(code: string): MineruErrorCode {
  if (AUTH_CODES.has(code)) return "mineru_auth";
  if (INPUT_CODES.has(code)) return "mineru_input";
  if (QUOTA_CODES.has(code)) return "mineru_quota";
  return "mineru_api";
}

interface ResponseEnvelope {
  code?: string | number | null;
  msg?: string | null;
  message?: string | null;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function safeJson(resp: Response): Promise<ResponseEnvelope> {
  try {
    const body = (await resp.json()) as unknown;
    return isRecord(body) ? (body as ResponseEnvelope) : { data: body };
  } catch {
    return {};
  }
}

export class MineruClient {
  private readonly token: string;
  private readonly fetchFn: MineruFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly pollInitialMs: number;
  private readonly pollMaxMs: number;
  private readonly pollTotalTimeoutMs: number;
  private readonly signal?: AbortSignal;

  constructor(opts: MineruClientOptions) {
    this.token = opts.token;
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.signal = opts.signal;
    // Sleep must be abort-aware — pollUntilDone waits up to POLL_MAX_MS (30s)
    // between polls, and an unaware sleep would let the user's Cancel wait
    // the full backoff window before the next throwIfAborted runs.
    const signal = this.signal;
    this.sleep =
      opts.sleep ??
      ((ms) =>
        new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new MineruClientError("mineru_api", "request aborted"));
            return;
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, ms);
          const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new MineruClientError("mineru_api", "request aborted"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        }));
    this.now = opts.now ?? (() => Date.now());
    this.pollInitialMs = opts.pollInitialMs ?? POLL_INITIAL_MS;
    this.pollMaxMs = opts.pollMaxMs ?? POLL_MAX_MS;
    this.pollTotalTimeoutMs = opts.pollTotalTimeoutMs ?? POLL_TOTAL_TIMEOUT_MS;
  }

  async submit(params: SubmitParams): Promise<SubmissionHandle> {
    const filesEntry: Record<string, unknown> = {
      name: params.fileName,
      is_ocr: params.isOcr ?? false,
      data_id: params.dataId
    };
    const payload: Record<string, unknown> = {
      enable_formula: params.enableFormula ?? true,
      enable_table: params.enableTable ?? true,
      language: params.language ?? "ch",
      cache_tolerance: CACHE_TOLERANCE_SEC,
      files: [filesEntry]
    };
    if (params.modelVersion !== null && params.modelVersion !== undefined) {
      payload.model_version = params.modelVersion;
    }
    const body = await this.requestJsonWithRetry("POST", SUBMIT_URL, payload);
    const data = isRecord(body.data) ? body.data : null;
    const batchId =
      typeof data?.batch_id === "string" && data.batch_id ? data.batch_id : null;
    const urls = Array.isArray(data?.file_urls) ? (data.file_urls as unknown[]) : null;
    const uploadUrl =
      urls && urls.length > 0 && typeof urls[0] === "string" && urls[0]
        ? (urls[0] as string)
        : null;
    if (!batchId || !uploadUrl) {
      throw new MineruClientError(
        "mineru_api",
        scrub(
          `MinerU submit response missing batch_id/file_urls: ${JSON.stringify(body)}`,
          this.token
        )
      );
    }
    return { batchId, uploadUrl };
  }

  async upload(uploadUrl: string, body: Uint8Array | Blob): Promise<void> {
    this.throwIfAborted();
    let response: Response;
    try {
      const init: RequestInit = {
        method: "PUT",
        body: body as BodyInit,
        // Critical: OSS rejects the presigned PUT signature if any
        // Content-Type header is sent (the server pre-signed for "").
        headers: {}
      };
      if (this.signal) init.signal = this.signal;
      response = await this.fetchFn(uploadUrl, init);
    } catch (exc) {
      throw new MineruClientError(
        "mineru_api",
        scrub(
          `MinerU upload network error: ${exc instanceof Error ? exc.message : String(exc)}`,
          this.token
        )
      );
    }
    if (response.status >= 400) {
      throw new MineruClientError(
        "mineru_api",
        `MinerU upload failed: HTTP ${response.status}`
      );
    }
  }

  async pollUntilDone(batchId: string): Promise<string> {
    const url = RESULT_URL(batchId);
    const deadline = this.now() + this.pollTotalTimeoutMs;
    let wait = this.pollInitialMs;
    let lastState = "";
    while (true) {
      this.throwIfAborted();
      const body = await this.requestJsonWithRetry("GET", url);
      const data = isRecord(body.data) ? body.data : {};
      const extract = (data as Record<string, unknown>).extract_result;
      let first: Record<string, unknown> = {};
      if (Array.isArray(extract)) {
        const head = extract[0];
        if (head !== undefined && !isRecord(head)) {
          throw new MineruClientError(
            "mineru_api",
            scrub(
              `MinerU poll extract_result[0] not a dict: ${JSON.stringify(body)}`,
              this.token
            )
          );
        }
        first = (head ?? {}) as Record<string, unknown>;
      } else if (extract !== undefined && extract !== null) {
        throw new MineruClientError(
          "mineru_api",
          scrub(
            `MinerU poll extract_result not a list: ${JSON.stringify(body)}`,
            this.token
          )
        );
      }
      const rawState = first.state;
      if (rawState !== undefined && typeof rawState !== "string") {
        throw new MineruClientError(
          "mineru_api",
          scrub(
            `MinerU poll state is not a string: ${JSON.stringify(body)}`,
            this.token
          )
        );
      }
      const state = (rawState as string | undefined) ?? "pending";
      lastState = state;
      if (state === STATE_DONE) {
        const fullZipUrl = first.full_zip_url;
        if (typeof fullZipUrl !== "string" || !fullZipUrl) {
          throw new MineruClientError(
            "mineru_api",
            scrub(
              `MinerU task done but full_zip_url missing: ${JSON.stringify(body)}`,
              this.token
            )
          );
        }
        return fullZipUrl;
      }
      if (state === STATE_FAILED) {
        this.raiseForCode(first.err_code, first.err_msg, "task");
      }
      if (this.now() >= deadline) {
        throw new MineruClientError(
          "mineru_timeout",
          `MinerU task did not finish within ${this.pollTotalTimeoutMs}ms (last state=${JSON.stringify(lastState)})`
        );
      }
      await this.sleep(wait);
      wait = Math.min(wait * POLL_BACKOFF_FACTOR, this.pollMaxMs);
    }
  }

  async downloadZip(zipUrl: string): Promise<Uint8Array> {
    this.throwIfAborted();
    let response: Response;
    try {
      const init: RequestInit = { method: "GET", redirect: "follow" };
      if (this.signal) init.signal = this.signal;
      response = await this.fetchFn(zipUrl, init);
    } catch (exc) {
      throw new MineruClientError(
        "mineru_api",
        `MinerU result download network error: ${exc instanceof Error ? exc.message : String(exc)}`
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new MineruClientError(
        "mineru_api",
        `MinerU result download failed: HTTP ${response.status}`
      );
    }
    const declared = response.headers.get("Content-Length");
    if (declared !== null) {
      const declaredN = Number(declared);
      if (Number.isFinite(declaredN) && declaredN > MAX_ZIP_DOWNLOAD_BYTES) {
        throw new MineruClientError(
          "mineru_input",
          `MinerU result ZIP Content-Length ${declaredN} exceeds ${MAX_ZIP_DOWNLOAD_BYTES} bytes download cap`
        );
      }
    }
    // Stream the body so we can abort before allocating ``MAX``+ bytes.
    if (!response.body) {
      const buf = new Uint8Array(await response.arrayBuffer());
      if (buf.byteLength > MAX_ZIP_DOWNLOAD_BYTES) {
        throw new MineruClientError(
          "mineru_input",
          `MinerU result ZIP exceeds ${MAX_ZIP_DOWNLOAD_BYTES} bytes download cap`
        );
      }
      return buf;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ZIP_DOWNLOAD_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new MineruClientError(
          "mineru_input",
          `MinerU result ZIP exceeds ${MAX_ZIP_DOWNLOAD_BYTES} bytes download cap`
        );
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  // -------- internals --------

  private async requestJsonWithRetry(
    method: string,
    url: string,
    payload?: unknown
  ): Promise<ResponseEnvelope> {
    const op = `${method} ${url}`;
    let backoff = RETRY_INITIAL_BACKOFF_MS;
    let lastError: MineruClientError | null = null;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      this.throwIfAborted();
      let response: Response;
      try {
        const init: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json"
          }
        };
        if (payload !== undefined) {
          init.body = JSON.stringify(payload);
        }
        if (this.signal) init.signal = this.signal;
        response = await this.fetchFn(url, init);
      } catch (exc) {
        if (attempt < RETRY_ATTEMPTS) {
          await this.sleep(backoff);
          backoff *= 2;
          continue;
        }
        const message = exc instanceof Error ? exc.message : String(exc);
        throw new MineruClientError(
          "mineru_api",
          scrub(`${op}: network error after ${attempt} attempts: ${message}`, this.token)
        );
      }
      const status = response.status;
      if (status >= 400 && status < 500) {
        const body = await safeJson(response);
        this.raiseForCode(body.code, body.msg ?? body.message, `HTTP ${status}`);
        // raiseForCode always throws; this is unreachable.
        throw new MineruClientError("mineru_api", `${op}: HTTP ${status}`);
      }
      if (status >= 500) {
        lastError = new MineruClientError(
          "mineru_api",
          `${op}: HTTP ${status} ${response.statusText}`
        );
        if (attempt < RETRY_ATTEMPTS) {
          await this.sleep(backoff);
          backoff *= 2;
          continue;
        }
        throw lastError;
      }
      const body = await safeJson(response);
      const apiCode = body.code;
      if (apiCode !== undefined && apiCode !== null && apiCode !== 0 && apiCode !== "0") {
        this.raiseForCode(apiCode, body.msg ?? body.message, `HTTP ${status}`);
      }
      return body;
    }
    throw lastError ?? new MineruClientError("mineru_api", `${op}: exhausted retries`);
  }

  private raiseForCode(
    code: unknown,
    msg: unknown,
    context: string
  ): never {
    const scode = code === null || code === undefined ? "" : String(code);
    let text: string;
    if (msg === null || msg === undefined || msg === "") {
      text = "(no message)";
    } else if (typeof msg === "string") {
      text = scrub(msg, this.token);
    } else {
      text = scrub(JSON.stringify(msg), this.token);
    }
    const cls = classify(scode);
    if (cls === "mineru_auth") {
      throw new MineruClientError(
        "mineru_auth",
        `MinerU rejected token in ${context} (${scode}: ${text}); token ${redact(this.token)}. Re-issue at mineru.net → API manage if expired.`
      );
    }
    throw new MineruClientError(cls, `MinerU ${context} error (${scode}: ${text})`);
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) {
      throw new MineruClientError("mineru_api", "request aborted");
    }
  }
}
