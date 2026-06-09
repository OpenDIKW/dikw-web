// Browser-side wrapper around the /web/translate endpoint (job + poll, mirroring
// src/utils/mineru-convert.ts). Translates a document's markdown blocks to a
// target language and returns the translations aligned 1:1 with the input.
//
// Idempotency: IndexedDB keyed by sha256(targetLang + blocks). Same source +
// language → cache hit, no network. translateVersion gates invalidation.

import { sha256HexString } from "./import-bundle";
import { CACHE_TTL_MS, isCacheEntryExpired } from "./mineru-convert";

// Bump when the translation logic changes in a way that makes previously-cached
// results wrong (the key embeds this, so old entries miss and re-translate).
// v2: server-side repair of untranslated / oversized / bilingual-echo blocks.
const TRANSLATE_VERSION = 2;
const DB_NAME = "dikw-translate-cache";
const DB_STORE = "entries";
const DB_VERSION = 1;

const POLL_INTERVAL_MS = 1200;
const POLL_MAX_FAILURES = 8;
const POLL_RETRY_CAP_MS = 15000;

function pollRetryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), POLL_RETRY_CAP_MS);
}

/** A block translated so far, mirroring the server's `{ i, tr }` wire shape. */
export interface TranslatedBlock {
  i: number;
  tr: string;
}

export type TranslateProgress =
  | { phase: "hashing" }
  | { phase: "submitting" }
  | { phase: "polling" }
  | { phase: "cache_hit" }
  /** Emitted while the job runs as more batches land, carrying every block
   *  translated so far so the caller can reveal them progressively. */
  | { phase: "partial"; blocks: TranslatedBlock[] };

export interface TranslateCache {
  get(key: string): Promise<string[] | null>;
  put(key: string, value: string[]): Promise<void>;
}

export interface TranslateOptions {
  /** Target language code; defaults to "zh". */
  targetLang?: string;
  signal?: AbortSignal;
  onProgress?: (e: TranslateProgress) => void;
  cache?: TranslateCache | null;
  /** Override for tests. */
  fetch?: typeof fetch;
  pollIntervalMs?: number;
}

export type TranslateErrorCode =
  | "translator_auth"
  | "translator_rate_limit"
  | "translator_timeout"
  | "translator_api"
  | "translator_invalid_response"
  | "translator_input"
  | "translate_disabled"
  | "aborted"
  | "invalid_response";

export class TranslateError extends Error {
  readonly code: TranslateErrorCode;
  constructor(code: TranslateErrorCode, message: string) {
    super(message);
    this.name = "TranslateError";
    this.code = code;
  }
}

/** Translate `blocks` into `targetLang`. Returns translations aligned 1:1 with
 *  the input order. Throws TranslateError on failure / abort. */
export async function translateBlocks(
  blocks: string[],
  opts: TranslateOptions = {},
): Promise<string[]> {
  const signal = opts.signal;
  const fetchFn = opts.fetch ?? fetch;
  const targetLang = opts.targetLang ?? "zh";
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  throwIfAborted(signal);
  if (blocks.length === 0) return [];

  opts.onProgress?.({ phase: "hashing" });
  const key = await cacheKey(blocks, targetLang);
  throwIfAborted(signal);
  if (opts.cache) {
    const hit = await opts.cache.get(key);
    if (hit && hit.length === blocks.length) {
      opts.onProgress?.({ phase: "cache_hit" });
      return hit;
    }
  }

  opts.onProgress?.({ phase: "submitting" });
  const jobId = await submitJob(blocks, targetLang, signal, fetchFn);
  opts.onProgress?.({ phase: "polling" });
  await pollUntilTerminal(jobId, signal, fetchFn, pollIntervalMs, opts.onProgress);
  const response = await fetchResult(jobId, signal, fetchFn, pollIntervalMs);
  if (response.status >= 400) {
    const body = await safeJson(response);
    throw new TranslateError(
      pickErrorCode(body, response.status),
      serverErrorMessage(body) ?? `translate result HTTP ${response.status}`,
    );
  }
  const body = await safeJson(response);
  const translations = alignBlocks(body, blocks.length);
  if (opts.cache) {
    try {
      await opts.cache.put(key, translations);
    } catch {
      // Cache write failure shouldn't block the result.
    }
  }
  return translations;
}

/** GET /web/translate/health → whether the sidecar has a translator key. The
 *  reader hides the AI 翻译 entry when this is false. Any failure → false. */
export async function fetchTranslateEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchFn("/web/translate/health", { method: "GET" });
    if (!response.ok) return false;
    const body = await safeJson(response);
    return Boolean((body as { enabled?: unknown } | null)?.enabled);
  } catch {
    return false;
  }
}

function alignBlocks(body: unknown, expected: number): string[] {
  const raw = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(raw)) {
    throw new TranslateError("invalid_response", "translate result missing blocks array");
  }
  const out = new Array<string>(expected).fill("");
  for (const item of raw) {
    if (item && typeof item === "object" && "i" in item && "tr" in item) {
      const i = (item as { i: unknown }).i;
      const tr = (item as { tr: unknown }).tr;
      if (typeof i === "number" && i >= 0 && i < expected && typeof tr === "string") {
        out[i] = tr;
      }
    }
  }
  return out;
}

async function cacheKey(blocks: string[], targetLang: string): Promise<string> {
  // Join on NUL: it can't appear in markdown source, so distinct block arrays
  // can't collide into one key (a space separator would: ["a b","c"] and
  // ["a","b c"] both flatten to "a b c", and the length guard wouldn't catch it).
  return sha256HexString(`${TRANSLATE_VERSION}\n${targetLang}\n${blocks.join("\u0000")}`);
}

// ------------------------------------------------- job submit / poll / result

function jobUrl(jobId: string): string {
  return `/web/translate/jobs/${encodeURIComponent(jobId)}`;
}

async function submitJob(
  blocks: string[],
  targetLang: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn("/web/translate/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks, targetLang }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TranslateError("aborted", "aborted");
    throw new TranslateError("translator_api", err instanceof Error ? err.message : String(err));
  }
  if (response.status >= 400) {
    const body = await safeJson(response);
    throw new TranslateError(
      pickErrorCode(body, response.status),
      serverErrorMessage(body) ?? `translate submit HTTP ${response.status}`,
    );
  }
  const body = await safeJson(response);
  const jobId =
    body && typeof body === "object" && "jobId" in body
      ? (body as { jobId?: unknown }).jobId
      : undefined;
  if (typeof jobId !== "string" || !jobId) {
    throw new TranslateError("invalid_response", "translate submit response missing jobId");
  }
  return jobId;
}

async function pollUntilTerminal(
  jobId: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
  pollIntervalMs: number,
  onProgress?: (e: TranslateProgress) => void,
): Promise<void> {
  let failures = 0;
  let lastPartialCount = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      let response: Response;
      try {
        response = await fetchFn(jobUrl(jobId), { method: "GET", signal });
      } catch (err) {
        if (signal?.aborted) throw new TranslateError("aborted", "aborted");
        if (++failures > POLL_MAX_FAILURES) {
          throw new TranslateError(
            "translator_api",
            err instanceof Error ? err.message : String(err),
          );
        }
        await delay(pollRetryDelayMs(failures, pollIntervalMs), signal);
        continue;
      }
      if (response.status === 404) {
        throw new TranslateError(
          "translator_api",
          "translation job not found (the server may have restarted or evicted it)",
        );
      }
      if (response.status >= 500) {
        if (++failures > POLL_MAX_FAILURES) {
          throw new TranslateError("translator_api", `translate job poll HTTP ${response.status}`);
        }
        await delay(pollRetryDelayMs(failures, pollIntervalMs), signal);
        continue;
      }
      if (response.status >= 400) {
        const body = await safeJson(response);
        throw new TranslateError(
          pickErrorCode(body, response.status),
          serverErrorMessage(body) ?? `translate job poll HTTP ${response.status}`,
        );
      }
      failures = 0;
      const body = await safeJson(response);
      const partial = partialBlocksOf(body);
      // The server republishes the same growing array on every poll; only surface
      // a partial when new blocks have actually landed, so the dual column isn't
      // re-rendered (every block, both columns) on each poll interval.
      if (partial.length > lastPartialCount) {
        lastPartialCount = partial.length;
        onProgress?.({ phase: "partial", blocks: partial });
      }
      const status = jobStatusOf(body);
      if (status === "succeeded") return;
      if (status === "failed") {
        throw new TranslateError(
          pickErrorCode(body, 200),
          serverErrorMessage(body) ?? "translation failed",
        );
      }
      await delay(pollIntervalMs, signal);
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof TranslateError && err.code === "aborted")) {
      void cancelJob(jobId, fetchFn);
      throw new TranslateError("aborted", "aborted");
    }
    throw err;
  }
}

async function fetchResult(
  jobId: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
  pollIntervalMs: number,
): Promise<Response> {
  let failures = 0;
  while (true) {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await fetchFn(`${jobUrl(jobId)}/result`, { method: "GET", signal });
    } catch (err) {
      if (signal?.aborted) throw new TranslateError("aborted", "aborted");
      if (++failures > POLL_MAX_FAILURES) {
        throw new TranslateError(
          "translator_api",
          err instanceof Error ? err.message : String(err),
        );
      }
      await delay(pollRetryDelayMs(failures, pollIntervalMs), signal);
      continue;
    }
    if (response.status >= 500) {
      if (++failures > POLL_MAX_FAILURES) {
        throw new TranslateError("translator_api", `translate result HTTP ${response.status}`);
      }
      await delay(pollRetryDelayMs(failures, pollIntervalMs), signal);
      continue;
    }
    return response;
  }
}

async function cancelJob(jobId: string, fetchFn: typeof fetch): Promise<void> {
  try {
    await fetchFn(`${jobUrl(jobId)}/cancel`, { method: "POST" });
  } catch {
    // best-effort
  }
}

function jobStatusOf(body: unknown): string {
  if (body && typeof body === "object" && "status" in body) {
    const s = (body as { status?: unknown }).status;
    if (typeof s === "string") return s;
  }
  return "";
}

/** Extract `progress.blocks` (the blocks translated so far) from a poll body,
 *  validating each `{ i, tr }` so a malformed payload never reaches the caller. */
function partialBlocksOf(body: unknown): TranslatedBlock[] {
  const raw = (body as { progress?: { blocks?: unknown } } | null)?.progress?.blocks;
  if (!Array.isArray(raw)) return [];
  const out: TranslatedBlock[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "i" in item && "tr" in item) {
      const i = (item as { i: unknown }).i;
      const tr = (item as { tr: unknown }).tr;
      if (typeof i === "number" && i >= 0 && typeof tr === "string") out.push({ i, tr });
    }
  }
  return out;
}

function serverErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<TranslateErrorCode>([
  "translator_auth",
  "translator_rate_limit",
  "translator_timeout",
  "translator_api",
  "translator_invalid_response",
  "translator_input",
  "translate_disabled",
]);

function pickErrorCode(body: unknown, status: number): TranslateErrorCode {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string" && KNOWN_CODES.has(code)) {
      return code as TranslateErrorCode;
    }
  }
  if (status === 503) return "translate_disabled";
  if (status === 401) return "translator_auth";
  if (status === 413) return "translator_input";
  if (status === 429) return "translator_rate_limit";
  if (status === 504) return "translator_timeout";
  return "translator_api";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new TranslateError("aborted", "aborted");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TranslateError("aborted", "aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TranslateError("aborted", "aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ----------------------------------------------------------- IndexedDB cache

/** In-memory cache; fallback for jsdom and a deterministic test shim. */
export class MemoryTranslateCache implements TranslateCache {
  private readonly store = new Map<string, string[]>();
  async get(key: string): Promise<string[] | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string[]): Promise<void> {
    this.store.set(key, value);
  }
}

interface TranslateCacheRecord {
  translateVersion: number;
  translations: string[];
  cachedAt: number;
}

/** IndexedDB-backed cache. Returns null when IndexedDB is unavailable (jsdom). */
export function tryOpenDefaultTranslateCache(): Promise<TranslateCache | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise<TranslateCache | null>((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => {
      const cache = new IDBTranslateCache(req.result);
      scheduleIdleSweep(cache);
      resolve(cache);
    };
    req.onerror = () => resolve(null);
  });
}

function scheduleIdleSweep(cache: IDBTranslateCache): void {
  const run = () => {
    void cache.sweepExpired().catch(() => {});
  };
  const ric = (
    globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(run, { timeout: 10000 });
  } else {
    setTimeout(run, 0);
  }
}

export class IDBTranslateCache implements TranslateCache {
  constructor(private readonly db: IDBDatabase) {}

  /** Delete entries older than CACHE_TTL_MS via a readwrite cursor. Resolves on
   *  transaction commit; rejects on error so the caller can swallow it. */
  sweepExpired(now: number = Date.now()): Promise<void> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(DB_STORE, "readwrite");
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("sweepExpired transaction aborted"));
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(DB_STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const record = cursor.value as TranslateCacheRecord | undefined;
        if (isCacheEntryExpired(record?.cachedAt, now, CACHE_TTL_MS)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<string[] | null> {
    const record = await this.txGet(key);
    if (!record || record.translateVersion !== TRANSLATE_VERSION) return null;
    if (isCacheEntryExpired(record.cachedAt, Date.now(), CACHE_TTL_MS)) return null;
    return record.translations;
  }

  async put(key: string, value: string[]): Promise<void> {
    const record: TranslateCacheRecord = {
      translateVersion: TRANSLATE_VERSION,
      translations: value,
      cachedAt: Date.now(),
    };
    await this.txPut(key, record);
  }

  private txGet(key: string): Promise<TranslateCacheRecord | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as TranslateCacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private txPut(key: string, value: TranslateCacheRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(DB_STORE, "readwrite");
      const req = tx.objectStore(DB_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
