// Browser-side wrapper around the /web/mineru/convert endpoint.
//
// Public surface:
//   * convertSource(file) — POST file to sidecar, get back markdown + assets.
//                            Skips network on IndexedDB cache hit.
//   * convertedToFiles(c) — materialize ConvertedSource into File[] that
//                            buildImportBundle's scanFiles strips correctly
//                            (webkitRelativePath="_mineru/<stem>/...").
//
// Idempotency layer (b) in the plan: IndexedDB keyed by sha256(input). Same
// file content → same cache key, regardless of filename. mineruVersion gates
// invalidation when the rewrite logic changes.

import { sha256Hex } from "./import-bundle";
import { readTar, TarReaderError } from "./tar-reader";

export const MINERU_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx"
]);

const MINERU_VERSION = 1;
const DB_NAME = "dikw-mineru-cache";
const DB_STORE = "entries";
const DB_VERSION = 1;

/** Cached conversions are retained for 7 days from their write time, then
 *  swept on the next time the cache is opened (issue: IndexedDB cache growth).
 *  Absolute TTL — a cache hit does not refresh ``cachedAt``. */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Browser-driven poll cadence for the detached conversion job. Each poll is a
// short, independent request (issue #60) — no held connection, so there's
// nothing for a reverse proxy to time out; the sidecar's 10-min budget stays
// the authoritative ceiling. POLL_MAX_FAILURES bounds transient-error retries.
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_FAILURES = 8;
const POLL_RETRY_CAP_MS = 15000;

/** Capped exponential backoff for transient poll/result failures, scaled off
 *  the poll interval (so tests with a tiny interval stay fast). Mirrors the
 *  reconnect backoff DikwClient.streamTaskEvents uses for the same flaky-proxy
 *  reason (#56), so a longer tunnel blip doesn't abort a still-running job. */
function pollRetryDelayMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** (attempt - 1), POLL_RETRY_CAP_MS);
}

export interface ConvertedSource {
  input: File;
  inputSha: string;
  stem: string;
  markdown: string;
  /** "assets/<relpath>" keys (matches the wire form from sidecar). */
  assets: Map<string, Uint8Array>;
}

export type ConvertProgress =
  | { phase: "hashing" }
  | { phase: "uploading" }
  | { phase: "polling" }
  | { phase: "downloading" }
  | { phase: "cache_hit" };

export interface ConvertCache {
  get(key: string): Promise<ConvertedSource | null>;
  put(key: string, value: ConvertedSource): Promise<void>;
}

export interface ConvertOptions {
  signal?: AbortSignal;
  onProgress?: (e: ConvertProgress) => void;
  cache?: ConvertCache | null;
  /** When set, forwarded to the sidecar so it records the true original
   *  filename in frontmatter even though the uploaded File was renamed
   *  (shortened) for MinerU. Defaults to the uploaded File's name. */
  originalFilename?: string;
  /** Override for tests. */
  fetch?: typeof fetch;
  /** Inter-poll interval (and transient-retry wait) for the job status poll.
   *  Defaults to POLL_INTERVAL_MS; overridable for tests. */
  pollIntervalMs?: number;
}

export type MineruConvertErrorCode =
  | "mineru_auth"
  | "mineru_input"
  | "mineru_quota"
  | "mineru_timeout"
  | "mineru_api"
  | "mineru_disabled"
  | "aborted"
  | "invalid_response";

export class MineruConvertError extends Error {
  readonly code: MineruConvertErrorCode;
  constructor(code: MineruConvertErrorCode, message: string) {
    super(message);
    this.name = "MineruConvertError";
    this.code = code;
  }
}

export async function convertSource(
  file: File,
  opts: ConvertOptions = {}
): Promise<ConvertedSource> {
  const signal = opts.signal;
  const fetchFn = opts.fetch ?? fetch;
  signalThrowIfAborted(signal);
  opts.onProgress?.({ phase: "hashing" });
  const buf = await file.arrayBuffer();
  const inputSha = await sha256Hex(buf);
  signalThrowIfAborted(signal);
  if (opts.cache) {
    const hit = await opts.cache.get(inputSha);
    if (hit) {
      opts.onProgress?.({ phase: "cache_hit" });
      return hit;
    }
  }
  opts.onProgress?.({ phase: "uploading" });
  const fd = new FormData();
  fd.append("file", file);
  let submitUrl = `/web/mineru/convert?inputSha=${encodeURIComponent(inputSha)}`;
  if (opts.originalFilename) {
    submitUrl += `&originalFilename=${encodeURIComponent(opts.originalFilename)}`;
  }
  // Submit returns a job id immediately; the conversion then runs detached on
  // the sidecar. Polling and the result fetch are each short, independent
  // requests, so no single request approaches a reverse-proxy timeout (#60).
  const jobId = await submitJob(submitUrl, fd, signal, fetchFn);
  opts.onProgress?.({ phase: "polling" });
  await pollUntilTerminal(jobId, signal, fetchFn, opts.pollIntervalMs ?? POLL_INTERVAL_MS);
  opts.onProgress?.({ phase: "downloading" });
  const response = await fetchResult(jobId, signal, fetchFn, opts.pollIntervalMs ?? POLL_INTERVAL_MS);
  if (response.status >= 400) {
    const body = await safeJson(response);
    throw new MineruConvertError(
      pickErrorCode(body, response.status),
      serverErrorMessage(body) ?? `mineru result HTTP ${response.status}`
    );
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/x-tar+gzip")) {
    throw new MineruConvertError(
      "invalid_response",
      `unexpected content-type ${JSON.stringify(ct)}`
    );
  }
  const gzBytes = new Uint8Array(await response.arrayBuffer());
  signalThrowIfAborted(signal);
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzipBytes(gzBytes);
  } catch (err) {
    throw new MineruConvertError(
      "invalid_response",
      `failed to gunzip response: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let entries;
  try {
    entries = readTar(tarBytes);
  } catch (err) {
    if (err instanceof TarReaderError) {
      throw new MineruConvertError("invalid_response", `bad tar: ${err.message}`);
    }
    throw err;
  }
  const stem = stemOf(file.name);
  const mdName = `${stem}.md`;
  let markdown: string | null = null;
  const assets = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.archivePath === mdName) {
      markdown = new TextDecoder("utf-8").decode(entry.data);
    } else if (entry.archivePath.startsWith("assets/")) {
      assets.set(entry.archivePath, entry.data);
    }
  }
  if (markdown === null) {
    throw new MineruConvertError(
      "invalid_response",
      `sidecar tar missing ${mdName}`
    );
  }
  const converted: ConvertedSource = {
    input: file,
    inputSha,
    stem,
    markdown,
    assets
  };
  if (opts.cache) {
    try {
      await opts.cache.put(inputSha, converted);
    } catch {
      // Cache write failure shouldn't block the conversion result.
    }
  }
  return converted;
}

export function convertedToFiles(c: ConvertedSource): File[] {
  // Suffix the synthetic root with a short content-hash prefix so two
  // converted inputs that happen to share a `stem` (e.g. `report.pdf`
  // from different vault folders) don't collapse onto the same archive
  // path and get dropped by buildImportBundle.scanFiles as
  // `duplicate_path`. The hash prefix is content-derived, so identical
  // bytes still produce the same synthetic root — idempotency holds.
  const root = `${c.stem}-${c.inputSha.slice(0, 12)}`;
  const files: File[] = [];
  files.push(
    syntheticFile(
      `${c.stem}.md`,
      `_mineru/${root}/${c.stem}.md`,
      new TextEncoder().encode(c.markdown),
      "text/markdown"
    )
  );
  // Sort assets so iteration order doesn't perturb buildImportBundle's sha.
  const keys = Array.from(c.assets.keys()).sort();
  for (const archivePath of keys) {
    const data = c.assets.get(archivePath)!;
    const basename = archivePath.split("/").pop() ?? archivePath;
    files.push(
      syntheticFile(basename, `_mineru/${root}/${archivePath}`, data)
    );
  }
  return files;
}

function syntheticFile(
  name: string,
  webkitRelativePath: string,
  data: Uint8Array,
  type?: string
): File {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const file = new File([buf], name, type ? { type } : undefined);
  Object.defineProperty(file, "webkitRelativePath", {
    value: webkitRelativePath,
    enumerable: true,
    configurable: true,
    writable: false
  });
  return file;
}

function stemOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const i = base.lastIndexOf(".");
  const stem = i < 0 ? base : base.slice(0, i);
  // Strip path / wikilink-breaking chars so the synthesized archive path
  // doesn't accidentally split into multiple segments.
  return stem.replace(/[\\/]/g, "_").replace(/[\]|]/g, "_") || "untitled";
}

function signalThrowIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new MineruConvertError("aborted", "aborted");
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function pickErrorCode(body: unknown, status: number): MineruConvertErrorCode {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string") {
      if (
        code === "mineru_auth" ||
        code === "mineru_input" ||
        code === "mineru_quota" ||
        code === "mineru_timeout" ||
        code === "mineru_api" ||
        code === "mineru_disabled"
      ) {
        return code;
      }
    }
  }
  if (status === 503) return "mineru_disabled";
  if (status === 401) return "mineru_auth";
  if (status === 413) return "mineru_input";
  if (status === 429) return "mineru_quota";
  if (status === 504) return "mineru_timeout";
  return "mineru_api";
}

// --------------------------------------------- job submit / poll / result (#60)

function jobUrl(jobId: string): string {
  return `/web/mineru/jobs/${encodeURIComponent(jobId)}`;
}

/** POST the file, get back a job id. The conversion then runs detached on the
 *  sidecar — this request returns in seconds regardless of conversion time. */
async function submitJob(
  submitUrl: string,
  fd: FormData,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(submitUrl, { method: "POST", body: fd, signal });
  } catch (err) {
    if (signal?.aborted) throw new MineruConvertError("aborted", "aborted");
    throw new MineruConvertError("mineru_api", err instanceof Error ? err.message : String(err));
  }
  if (response.status >= 400) {
    const body = await safeJson(response);
    throw new MineruConvertError(
      pickErrorCode(body, response.status),
      serverErrorMessage(body) ?? `mineru convert HTTP ${response.status}`
    );
  }
  const body = await safeJson(response);
  const jobId =
    body && typeof body === "object" && "jobId" in body
      ? (body as { jobId?: unknown }).jobId
      : undefined;
  if (typeof jobId !== "string" || !jobId) {
    throw new MineruConvertError("invalid_response", "mineru convert response missing jobId");
  }
  return jobId;
}

/** Poll GET /web/mineru/jobs/<id> until the job is terminal. Each poll is a
 *  short request; transient network/5xx failures retry up to POLL_MAX_FAILURES;
 *  a 404 (evicted job / restarted sidecar) is fatal. On abort, tells the sidecar
 *  to cancel (best-effort) and throws "aborted". */
async function pollUntilTerminal(
  jobId: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
  pollIntervalMs: number
): Promise<void> {
  let failures = 0;
  try {
    while (true) {
      signalThrowIfAborted(signal);
      let response: Response;
      try {
        response = await fetchFn(jobUrl(jobId), { method: "GET", signal });
      } catch (err) {
        if (signal?.aborted) throw new MineruConvertError("aborted", "aborted");
        if (++failures > POLL_MAX_FAILURES) {
          throw new MineruConvertError(
            "mineru_api",
            err instanceof Error ? err.message : String(err)
          );
        }
        await convertDelay(pollRetryDelayMs(failures, pollIntervalMs), signal);
        continue;
      }
      // 404 → job evicted / sidecar restarted: not transient, no result coming.
      if (response.status === 404) {
        throw new MineruConvertError(
          "mineru_api",
          "conversion job not found (the server may have restarted or evicted it)"
        );
      }
      if (response.status >= 500) {
        if (++failures > POLL_MAX_FAILURES) {
          throw new MineruConvertError("mineru_api", `mineru job poll HTTP ${response.status}`);
        }
        await convertDelay(pollRetryDelayMs(failures, pollIntervalMs), signal);
        continue;
      }
      if (response.status >= 400) {
        const body = await safeJson(response);
        throw new MineruConvertError(
          pickErrorCode(body, response.status),
          serverErrorMessage(body) ?? `mineru job poll HTTP ${response.status}`
        );
      }
      failures = 0;
      const body = await safeJson(response);
      const status = jobStatusOf(body);
      if (status === "succeeded") return;
      if (status === "failed") {
        // Surface the same wire code the sidecar recorded (mineru_quota / …).
        throw new MineruConvertError(
          pickErrorCode(body, 200),
          serverErrorMessage(body) ?? "mineru conversion failed"
        );
      }
      // pending | running | unknown → keep polling.
      await convertDelay(pollIntervalMs, signal);
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof MineruConvertError && err.code === "aborted")) {
      // Best-effort: tell the sidecar to stop the detached conversion. The UI
      // already reflects the user's cancel intent, so swallow any failure.
      void cancelJob(jobId, fetchFn);
      throw new MineruConvertError("aborted", "aborted");
    }
    throw err;
  }
}

/** Fetch the result tar.gz. Retries transient network/5xx failures (symmetric
 *  with the poll loop — the whole point of #60 is surviving a flaky transport,
 *  and the bytes are sitting ready on the sidecar). A 4xx (404 consumed/evicted,
 *  409 not-ready) is returned to the caller without retry. */
async function fetchResult(
  jobId: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
  pollIntervalMs: number
): Promise<Response> {
  let failures = 0;
  while (true) {
    signalThrowIfAborted(signal);
    let response: Response;
    try {
      response = await fetchFn(`${jobUrl(jobId)}/result`, { method: "GET", signal });
    } catch (err) {
      if (signal?.aborted) throw new MineruConvertError("aborted", "aborted");
      if (++failures > POLL_MAX_FAILURES) {
        throw new MineruConvertError("mineru_api", err instanceof Error ? err.message : String(err));
      }
      await convertDelay(pollRetryDelayMs(failures, pollIntervalMs), signal);
      continue;
    }
    if (response.status >= 500) {
      if (++failures > POLL_MAX_FAILURES) {
        throw new MineruConvertError("mineru_api", `mineru result HTTP ${response.status}`);
      }
      await convertDelay(pollRetryDelayMs(failures, pollIntervalMs), signal);
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

function serverErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

/** setTimeout as a promise that rejects with an "aborted" MineruConvertError the
 *  moment the signal fires, so a cancel during the poll wait exits at once. */
function convertDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MineruConvertError("aborted", "aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MineruConvertError("aborted", "aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available in this environment");
  }
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const source = new Response(new Blob([buf])).body!;
  const inflated = source.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

// ----------------------------------------------------------- IndexedDB cache

/** In-memory cache. Used as a fallback when IndexedDB is unavailable (jsdom)
 *  and as a deterministic shim for tests. */
export class MemoryConvertCache implements ConvertCache {
  private readonly store = new Map<string, ConvertedSource>();
  async get(key: string): Promise<ConvertedSource | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: ConvertedSource): Promise<void> {
    this.store.set(key, value);
  }
}

/** IndexedDB-backed cache. Returns null when IndexedDB is not available
 *  (jsdom test env, very old browsers). Caller should treat ``null`` as
 *  "no cache" and proceed without bypass. */
export function tryOpenDefaultCache(): Promise<ConvertCache | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise<ConvertCache | null>((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => {
      const cache = new IDBConvertCache(req.result);
      // Best-effort prune of entries older than CACHE_TTL_MS, deferred to idle.
      // The sweep takes a readwrite lock on the store, and IndexedDB serializes
      // a later readonly get() behind it — so running it eagerly on mount could
      // queue the import flow's first cache lookup behind a full scan/delete
      // pass. Deferring to requestIdleCallback lets foreground cache reads
      // create their transactions first; a stale entry served before the sweep
      // runs is harmless (same bytes → same conversion).
      scheduleIdleSweep(cache);
      resolve(cache);
    };
    req.onerror = () => resolve(null);
  });
}

/** Run the cache sweep when the browser is idle (or after a short fallback
 *  delay where requestIdleCallback is unavailable), so it never precedes the
 *  import flow's foreground cache reads. Errors are swallowed — cleanup is
 *  best-effort. */
function scheduleIdleSweep(cache: IDBConvertCache): void {
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

/** A cache entry is expired when it was written more than CACHE_TTL_MS ago.
 *  Exactly at the TTL is kept (strictly-older test). A missing or non-finite
 *  ``cachedAt`` (legacy / corrupt record) is treated as expired so the sweep
 *  reclaims it. Future-dated entries (clock skew) are kept. */
export function isCacheEntryExpired(
  cachedAt: unknown,
  now: number,
  ttlMs: number = CACHE_TTL_MS
): boolean {
  if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) return true;
  return now - cachedAt > ttlMs;
}

interface CacheRecord {
  mineruVersion: number;
  stem: string;
  markdown: string;
  assets: Array<[string, ArrayBuffer]>;
  cachedAt: number;
}

export class IDBConvertCache implements ConvertCache {
  constructor(private readonly db: IDBDatabase) {}

  /** Walk every entry with a readwrite cursor and delete those older than
   *  CACHE_TTL_MS. A cursor (rather than getAll) keeps only one record —
   *  which carries the full markdown + asset bytes — in memory at a time.
   *  Resolves on transaction commit (so the deletes are durable, and a
   *  delete-triggered abort surfaces as a rejection rather than a false
   *  success); rejects on a transaction/cursor error so the caller can
   *  swallow it. ``now`` is injectable for tests. */
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
        // Null cursor → iteration done; tx.oncomplete resolves once the
        // queued deletes commit.
        if (!cursor) return;
        const record = cursor.value as CacheRecord | undefined;
        if (isCacheEntryExpired(record?.cachedAt, now)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<ConvertedSource | null> {
    const record = await this.txGet(key);
    if (!record || record.mineruVersion !== MINERU_VERSION) return null;
    const assets = new Map<string, Uint8Array>();
    for (const [path, buf] of record.assets) {
      assets.set(path, new Uint8Array(buf));
    }
    // ``input`` is reconstructed as a synthetic File — callers expect a File,
    // but reflushing the original bytes isn't worth the storage. Use the stem
    // as a stand-in name; downstream code reads .input only for sizing /
    // diagnostics, never for the bytes themselves (those come from the
    // serialized assets + markdown).
    const placeholderName = `${record.stem}.cached`;
    const input = new File([new ArrayBuffer(0)], placeholderName);
    return {
      input,
      inputSha: key,
      stem: record.stem,
      markdown: record.markdown,
      assets
    };
  }

  async put(key: string, value: ConvertedSource): Promise<void> {
    const assets: Array<[string, ArrayBuffer]> = [];
    for (const [path, bytes] of value.assets) {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      assets.push([path, buf]);
    }
    const record: CacheRecord = {
      mineruVersion: MINERU_VERSION,
      stem: value.stem,
      markdown: value.markdown,
      assets,
      cachedAt: Date.now()
    };
    await this.txPut(key, record);
  }

  private txGet(key: string): Promise<CacheRecord | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(DB_STORE, "readonly");
      const store = tx.objectStore(DB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as CacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private txPut(key: string, value: CacheRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
