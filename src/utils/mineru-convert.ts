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
  /** Override for tests. */
  fetch?: typeof fetch;
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
  const url = `/web/mineru/convert?inputSha=${encodeURIComponent(inputSha)}`;
  let response: Response;
  try {
    response = await fetchFn(url, { method: "POST", body: fd, signal });
  } catch (err) {
    if (signal?.aborted) {
      throw new MineruConvertError("aborted", "aborted");
    }
    throw new MineruConvertError("mineru_api", err instanceof Error ? err.message : String(err));
  }
  if (response.status >= 400) {
    const body = await safeJson(response);
    const code = pickErrorCode(body, response.status);
    const serverMessage =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { message?: string } }).error?.message
        : undefined;
    throw new MineruConvertError(
      code,
      serverMessage ?? `mineru convert HTTP ${response.status}`
    );
  }
  opts.onProgress?.({ phase: "downloading" });
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
  const files: File[] = [];
  files.push(
    syntheticFile(
      `${c.stem}.md`,
      `_mineru/${c.stem}/${c.stem}.md`,
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
      syntheticFile(basename, `_mineru/${c.stem}/${archivePath}`, data)
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
    req.onsuccess = () => resolve(new IDBConvertCache(req.result));
    req.onerror = () => resolve(null);
  });
}

interface CacheRecord {
  mineruVersion: number;
  stem: string;
  markdown: string;
  assets: Array<[string, ArrayBuffer]>;
  cachedAt: number;
}

class IDBConvertCache implements ConvertCache {
  constructor(private readonly db: IDBDatabase) {}

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
