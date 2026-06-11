// Dispatcher for /web/* routes. Today: mineru convert + health. Future:
// other format converters / utility endpoints that don't belong in the
// chat agent's /agent namespace and aren't part of dikw-core's /v1
// contract.

import type { IncomingMessage, ServerResponse } from "node:http";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { buildTar } from "../../src/utils/tar.js";
import { MineruClient, MineruClientError } from "./mineruClient.js";
import { extractResultZip, MineruConvertError } from "./mineruConvert.js";
import {
  DEFAULT_TRANSLATOR_BASE_URL,
  DEFAULT_TRANSLATOR_MODEL,
  loadWebConfig,
  type WebConfig,
} from "./config.js";
import { JobLimitError, JobStore, type Job } from "./jobStore.js";
import { type AnthropicLike, TranslatorClient } from "./translatorClient.js";
import { runTranslation } from "./translateRun.js";

const gzipAsync = promisify(gzip);

// Mirror the 200 MB cap that MinerU enforces server-side, so we don't waste
// an upload round-trip on something MinerU would reject anyway. Streamed at
// chunk granularity in `bufferRequest` to avoid OOMing on an oversized POST.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Translation request bodies are JSON block arrays of a single document's prose;
// 4 MB is generous (a very large page) while bounding a pathological POST.
const MAX_TRANSLATE_BYTES = 4 * 1024 * 1024;
// Bound the per-request block count so a malformed/abusive payload can't fan a
// single LLM call into an enormous prompt.
const MAX_TRANSLATE_BLOCKS = 2000;
// targetLang is interpolated into the translator's system prompt, so it must be
// a bare BCP-47-ish tag — reject anything else (length-capped too) so it can't
// be used to smuggle instructions into the highest-trust prompt position.
const LANG_TAG = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})*$/;

class RequestTooLargeError extends Error {
  readonly limitBytes: number;
  constructor(limitBytes: number) {
    super(`request body exceeds ${limitBytes} byte cap`);
    this.name = "RequestTooLargeError";
    this.limitBytes = limitBytes;
  }
}

export interface WebHandlerOptions {
  cwd?: string;
  config?: WebConfig;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Override for tests so a test can drive the detached conversion job to
   *  completion and inspect it. Defaults to a fresh in-memory store. */
  jobStore?: JobStore;
  /** Test seam: inject a fake Anthropic transport for /web/translate so tests
   *  never hit the network. Defaults to a real client built per submit. */
  anthropic?: AnthropicLike;
}

export async function createDefaultWebHandler(cwd = process.cwd()): Promise<WebHandler> {
  const config = await loadWebConfig({ cwd });
  return createWebHandler({ cwd, config });
}

export type WebHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void,
) => Promise<void>;

export function createWebHandler(options: WebHandlerOptions = {}): WebHandler {
  const config = options.config ?? {};
  const fetchFn = options.fetch ?? globalThis.fetch;
  // One store per handler instance. `webApiPlugin` lazy-inits the handler once
  // in dev and `standalone.ts` creates it once in prod, so this is a stable
  // singleton for the process lifetime.
  const jobStore = options.jobStore ?? new JobStore();

  return async function webHandler(req, res, next) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const family = parts[0];
      if (family !== "mineru" && family !== "translate") {
        return notFound(res);
      }

      if (family === "mineru") {
        if (req.method === "GET" && parts[1] === "health") {
          return json(res, {
            enabled: Boolean(config.mineruApiKey),
            hasKey: Boolean(config.mineruApiKey),
          });
        }
        if (req.method === "POST" && parts[1] === "convert") {
          if (!config.mineruApiKey) {
            return errorJson(
              res,
              503,
              "mineru_disabled",
              "DIKW_WEB_MINERU_API_KEY is not configured on this sidecar",
            );
          }
          return handleConvert(req, res, url, config.mineruApiKey, fetchFn, jobStore);
        }
      }

      if (family === "translate") {
        if (req.method === "GET" && parts[1] === "health") {
          return json(res, { enabled: Boolean(config.translatorApiKey) });
        }
        if (req.method === "POST" && parts[1] === "submit") {
          if (!config.translatorApiKey) {
            return errorJson(
              res,
              503,
              "translate_disabled",
              "DIKW_AGENT_API_KEY is not configured on this sidecar",
            );
          }
          return handleTranslateSubmit(req, res, config, jobStore, options.anthropic);
        }
      }

      // Job status / result / cancel for a detached job (issue #60). These don't
      // gate on the API key — a job created while the key was present must stay
      // queryable regardless. `result` is dispatched per family (translate →
      // JSON, mineru → tar.gz); status / cancel are content-type agnostic.
      if (parts[1] === "jobs" && parts[2]) {
        const jobId = parts[2];
        if (req.method === "GET" && parts.length === 3) {
          return handleJobStatus(res, jobStore, jobId);
        }
        if (req.method === "GET" && parts.length === 4 && parts[3] === "result") {
          return family === "translate"
            ? handleTranslateResult(res, jobStore, jobId)
            : handleJobResult(res, jobStore, jobId);
        }
        if (req.method === "POST" && parts.length === 4 && parts[3] === "cancel") {
          return handleJobCancel(res, jobStore, jobId);
        }
      }
      return notFound(res);
    } catch (err) {
      if (next) {
        next(err);
        return;
      }
      console.error("[web] unhandled handler error", err);
      return errorJson(res, 500, "web_internal_error", "internal web handler error");
    }
  };
}

async function handleConvert(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  apiKey: string,
  fetchFn: typeof fetch,
  jobStore: JobStore,
): Promise<void> {
  const claimedInputSha = url.searchParams.get("inputSha");
  if (!claimedInputSha) {
    return errorJson(res, 400, "missing_input_sha", "inputSha query parameter is required");
  }
  // Reject obvious garbage early so we don't burn an upload on a request
  // that can't possibly satisfy the post-upload verification step.
  if (!/^[0-9a-f]{64}$/i.test(claimedInputSha)) {
    return errorJson(
      res,
      400,
      "invalid_input_sha",
      "inputSha must be a 64-char lowercase hex SHA-256",
    );
  }
  let fileName: string;
  let fileBytes: Uint8Array;
  try {
    const part = await readMultipartFile(req);
    fileName = part.filename || `upload-${claimedInputSha.slice(0, 8)}.bin`;
    fileBytes = part.data;
  } catch (err) {
    if (err instanceof RequestTooLargeError) {
      return errorJson(res, 413, "mineru_input", `request body exceeds ${err.limitBytes} byte cap`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorJson(res, 400, "invalid_multipart", message);
  }

  // Reverify the SHA-256 against the bytes we actually received — the
  // claimed value in the URL is only a hint. The verified hash is what we
  // use for mineru's `data_id` (the cache key), so a malicious or buggy
  // caller can't poison it.
  const inputSha = sha256Hex(fileBytes);
  if (inputSha !== claimedInputSha.toLowerCase()) {
    return errorJson(
      res,
      400,
      "input_sha_mismatch",
      `inputSha query param does not match SHA-256 of uploaded bytes`,
    );
  }

  const ext = extname(fileName).toLowerCase();
  const modelVersion = ext === ".pdf" ? "vlm" : null;
  const stem = stemOf(fileName);
  const dataId = inputSha.slice(0, 32);
  // The browser kebab-cases the filename before uploading (ADR 0004) but passes
  // the true original here so frontmatter stays honest. Strip CR/LF so a
  // pathological name can't break the YAML block. Falls back to the (kebab)
  // multipart filename when absent.
  const originalFilename =
    url.searchParams.get("originalFilename")?.replace(/[\r\n]+/g, " ") || fileName;

  // Run the conversion DETACHED from this request so its wall-clock no longer
  // bounds the request's time-to-first-byte (issue #60). We return 202 in
  // seconds; the browser polls GET /web/mineru/jobs/<id> and fetches the result
  // on completion, so no single request approaches a reverse-proxy timeout. The
  // controller's lifetime is the job, not the request (cancel via the cancel
  // route), so there is no req.on("aborted") wiring anymore.
  const controller = new AbortController();
  let job: Job;
  try {
    job = jobStore.create(controller);
  } catch (err) {
    if (err instanceof JobLimitError) {
      return errorJson(res, 503, "too_many_jobs", err.message);
    }
    throw err;
  }
  const client = new MineruClient({
    token: apiKey,
    fetch: fetchFn,
    signal: controller.signal,
  });
  void runConversion(jobStore, job.id, {
    client,
    fileBytes,
    fileName,
    modelVersion,
    stem,
    dataId,
    originalFilename,
  });
  return json(res, { jobId: job.id, status: "pending" }, 202);
}

interface ConversionArgs {
  client: MineruClient;
  fileBytes: Uint8Array;
  fileName: string;
  modelVersion: string | null;
  stem: string;
  dataId: string;
  originalFilename: string;
}

/** The MinerU pipeline, detached from any HTTP request. Updates the job record
 *  as it progresses; stores the gzipped tar on success and a mapped error code
 *  on any failure. MUST NOT let a rejection escape — an unhandled rejection in
 *  this `void`-ed promise would crash / log-spam the sidecar. Never references
 *  the request/response objects (they are gone once the 202 was sent). */
async function runConversion(store: JobStore, jobId: string, args: ConversionArgs): Promise<void> {
  try {
    store.setRunning(jobId);
    store.setPhase(jobId, "uploading");
    const handle = await args.client.submit({
      fileName: args.fileName,
      dataId: args.dataId,
      modelVersion: args.modelVersion,
    });
    await args.client.upload(handle.uploadUrl, args.fileBytes);
    store.setPhase(jobId, "polling");
    const zipUrl = await args.client.pollUntilDone(handle.batchId);
    store.setPhase(jobId, "downloading");
    const zipBytes = await args.client.downloadZip(zipUrl);
    const extracted = extractResultZip(zipBytes);
    const markdownWithFrontmatter = injectFrontmatter(extracted.markdown, args.originalFilename);
    const tarBytes = buildResponseTar(args.stem, markdownWithFrontmatter, extracted.assets);
    // Async gzip so a multi-hundred-MB tar doesn't block the event loop for
    // sister conversions. Level 6 (zlib default) — the marginal compression
    // from level 9 isn't worth the CPU cost on the server-side hot path.
    // gzipAsync returns a Buffer (a Uint8Array owning a fresh zlib allocation,
    // not pooled), and the result is only ever read, so store it directly —
    // copying a potentially multi-hundred-MB tar would just double peak memory.
    const gz = await gzipAsync(tarBytes);
    store.setSucceeded(jobId, gz);
  } catch (err) {
    const { code, message } = mapConvertError(err);
    store.setFailed(jobId, { code, message });
  }
}

async function handleTranslateSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebConfig,
  jobStore: JobStore,
  anthropic: AnthropicLike | undefined,
): Promise<void> {
  let raw: Uint8Array;
  try {
    raw = await bufferRequest(req, MAX_TRANSLATE_BYTES);
  } catch (err) {
    if (err instanceof RequestTooLargeError) {
      return errorJson(
        res,
        413,
        "translator_input",
        `request body exceeds ${err.limitBytes} byte cap`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorJson(res, 400, "invalid_request", message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(raw));
  } catch {
    return errorJson(res, 400, "invalid_request", "request body must be JSON");
  }
  const blocks = (parsed as { blocks?: unknown }).blocks;
  const targetLang = (parsed as { targetLang?: unknown }).targetLang;
  if (!Array.isArray(blocks) || blocks.some((b) => typeof b !== "string")) {
    return errorJson(res, 400, "invalid_request", "blocks must be a string array");
  }
  if (blocks.length === 0) {
    return errorJson(res, 400, "invalid_request", "blocks must not be empty");
  }
  if (blocks.length > MAX_TRANSLATE_BLOCKS) {
    return errorJson(res, 413, "translator_input", `too many blocks (max ${MAX_TRANSLATE_BLOCKS})`);
  }
  const rawLang = typeof targetLang === "string" ? targetLang.trim() : "";
  if (rawLang && (rawLang.length > 35 || !LANG_TAG.test(rawLang))) {
    return errorJson(
      res,
      400,
      "invalid_request",
      "targetLang must be a short language tag (e.g. zh, zh-CN)",
    );
  }
  const lang = rawLang || "zh";

  // Run the translation DETACHED from this request (issue #60): a slow LLM call
  // no longer bounds the request's time-to-first-byte. Return 202; the browser
  // polls GET /web/translate/jobs/<id> and fetches the JSON result on completion.
  const controller = new AbortController();
  let job: Job;
  try {
    job = jobStore.create(controller);
  } catch (err) {
    if (err instanceof JobLimitError) {
      return errorJson(res, 503, "too_many_jobs", err.message);
    }
    throw err;
  }
  const client = new TranslatorClient({
    apiKey: config.translatorApiKey!,
    baseUrl: config.translatorBaseUrl ?? DEFAULT_TRANSLATOR_BASE_URL,
    model: config.translatorModel ?? DEFAULT_TRANSLATOR_MODEL,
    maxTokens: config.translatorMaxTokens,
    signal: controller.signal,
    client: anthropic,
  });
  void runTranslation(jobStore, job.id, {
    client,
    blocks: blocks as string[],
    targetLang: lang,
  });
  return json(res, { jobId: job.id, status: "pending" }, 202);
}

/** Translate job result: block-aligned JSON `{ blocks: [{ i, tr }] }`. Mirrors
 *  handleJobResult but serves application/json (the generic handler serves the
 *  mineru tar.gz). Idempotent within the TTL window, same as mineru's. */
function handleTranslateResult(res: ServerResponse, store: JobStore, jobId: string): void {
  const job = store.get(jobId);
  if (!job) return notFound(res);
  if (job.status !== "succeeded") {
    return errorJson(res, 409, "not_ready", `translation job is ${job.status}`);
  }
  const bytes = store.peekResult(jobId);
  if (!bytes) return notFound(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.end(bytes);
}

function handleJobStatus(res: ServerResponse, store: JobStore, jobId: string): void {
  const job = store.get(jobId);
  if (!job) return notFound(res);
  const payload: Record<string, unknown> = { jobId: job.id, status: job.status };
  // `phase` is a coarse hint; the browser drives its substage off `status`.
  if (job.phase) payload.phase = job.phase;
  // `progress` (translate jobs) carries the blocks translated so far so the
  // browser can reveal them progressively while the job is still running.
  if (job.progress !== undefined) payload.progress = job.progress;
  if (job.error) payload.error = job.error;
  return json(res, payload);
}

function handleJobResult(res: ServerResponse, store: JobStore, jobId: string): void {
  const job = store.get(jobId);
  if (!job) return notFound(res);
  if (job.status !== "succeeded") {
    return errorJson(res, 409, "not_ready", `conversion job is ${job.status}`);
  }
  const gz = store.peekResult(jobId);
  // Idempotent within the TTL window: we do NOT delete on read, so a `/result`
  // transfer cut mid-flight by a flaky proxy can be retried (issue #60) instead
  // of hitting a consumed job. `!gz` only if a late fetch lost the race with the
  // TTL sweep / byte-cap eviction.
  if (!gz) return notFound(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-tar+gzip");
  res.setHeader("Content-Length", String(gz.byteLength));
  res.end(gz);
}

function handleJobCancel(res: ServerResponse, store: JobStore, jobId: string): void {
  const job = store.get(jobId);
  if (!job) return notFound(res);
  // Aborts the in-flight MinerU client calls; the detached runner's catch then
  // records a terminal (failed) state. The browser usually never reads that —
  // its own abort path short-circuits to an `aborted` error first.
  job.controller.abort();
  return json(res, { jobId: job.id, ok: true });
}

function buildResponseTar(
  stem: string,
  markdown: string,
  assets: Map<string, Uint8Array>,
): Uint8Array {
  // Sorted entries with mtime=0 (buildTar already enforces mtime=0). Sort
  // assets so byte-identical inputs produce byte-identical tars even
  // across Map iteration order changes.
  const entries: Array<{ archivePath: string; data: Uint8Array }> = [];
  entries.push({ archivePath: `${stem}.md`, data: new TextEncoder().encode(markdown) });
  const assetKeys = Array.from(assets.keys()).sort();
  for (const key of assetKeys) {
    entries.push({ archivePath: key, data: assets.get(key)! });
  }
  return buildTar(entries);
}

function injectFrontmatter(markdown: string, originalFilename: string): string {
  // Flat keys only (ADR 0004): the Base reader renders a nested value as JSON,
  // so ``original_filename`` and ``converter`` are top-level strings. Only
  // deterministic keys so the bundle is byte-stable for identical inputs — no
  // ``original_sha256``, no timestamps. MinerU output is machine-generated and
  // never carries author frontmatter, so a plain prepend (no merge) is safe.
  const fm = [
    "---",
    `original_filename: ${yamlSafe(originalFilename)}`,
    `converter: ${yamlSafe("mineru")}`,
    "---",
    "",
  ].join("\n");
  return fm + markdown;
}

function yamlSafe(value: string): string {
  // Always double-quote so filenames with spaces / special chars round-trip.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stemOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const i = base.lastIndexOf(".");
  const stem = i < 0 ? base : base.slice(0, i);
  // Replace characters that break tar paths or markdown wikilinks.
  return stem.replace(/[\\/]/g, "_").replace(/[\]|]/g, "_") || "untitled";
}

interface MultipartFile {
  filename: string;
  data: Uint8Array;
  mediaType: string;
}

async function readMultipartFile(req: IncomingMessage): Promise<MultipartFile> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.includes("multipart/form-data")) {
    throw new Error("expected multipart/form-data");
  }
  const body = await bufferRequest(req, MAX_UPLOAD_BYTES);
  return parseMultipartFile(body, ct);
}

async function bufferRequest(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  // Track the running total at chunk granularity so an oversized POST is
  // rejected as soon as it crosses the cap, rather than after the whole
  // body has accumulated in memory. Anything that arrives after the cap
  // is dropped (we still drain the request to let the client finish its
  // POST cleanly, but we never copy those bytes).
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = false;
  for await (const chunk of req as unknown as AsyncIterable<Buffer | Uint8Array>) {
    if (aborted) continue;
    const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    total += u8.byteLength;
    if (total > maxBytes) {
      aborted = true;
      continue;
    }
    chunks.push(u8);
  }
  if (aborted) {
    throw new RequestTooLargeError(maxBytes);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Minimal RFC 7578 parser scoped to single-file form submissions. We rolled
 *  this because undici's Response.formData() refuses bodies we hand-build
 *  (tests, and possibly cross-version misbehavior we'd rather not depend
 *  on). Only what we need: scan until the first part with a ``filename=``
 *  Content-Disposition param, return its bytes + media type. */
function parseMultipartFile(body: Uint8Array, contentType: string): MultipartFile {
  const m = /boundary=(?:"([^"]+)"|([^;,\s]+))/i.exec(contentType);
  if (!m) throw new Error("multipart Content-Type missing boundary");
  const boundary = (m[1] ?? m[2]).trim();
  const enc = new TextEncoder();
  const dashBoundary = enc.encode(`--${boundary}`);
  const crlf = enc.encode("\r\n");
  const crlfDashBoundary = enc.encode(`\r\n--${boundary}`);
  const headersTerm = enc.encode("\r\n\r\n");

  let cursor = indexOfBytes(body, dashBoundary, 0);
  if (cursor < 0) throw new Error("multipart: opening boundary not found");
  cursor += dashBoundary.length;
  while (cursor < body.byteLength) {
    // Closing delimiter "--<boundary>--" — no more parts.
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) {
      throw new Error("multipart: reached closing boundary with no file part");
    }
    if (body[cursor] === crlf[0] && body[cursor + 1] === crlf[1]) {
      cursor += 2;
    }
    const headersEnd = indexOfBytes(body, headersTerm, cursor);
    if (headersEnd < 0) throw new Error("multipart: part headers unterminated");
    const headersText = new TextDecoder("utf-8").decode(body.subarray(cursor, headersEnd));
    const partBodyStart = headersEnd + headersTerm.byteLength;
    const partBodyEnd = indexOfBytes(body, crlfDashBoundary, partBodyStart);
    if (partBodyEnd < 0) throw new Error("multipart: part body unterminated");
    const filenameMatch = /filename="([^"]*)"/i.exec(headersText);
    if (filenameMatch) {
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersText);
      return {
        filename: filenameMatch[1],
        data: body.slice(partBodyStart, partBodyEnd),
        mediaType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
      };
    }
    // Non-file part: skip past `\r\n--<boundary>`, continue at the next
    // boundary marker.
    cursor = partBodyEnd + crlfDashBoundary.byteLength;
  }
  throw new Error("multipart: no file part found");
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  outer: for (let i = start; i <= haystack.byteLength - needle.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

interface MappedConvertError {
  code: string;
  message: string;
}

/** Map any pipeline error to the wire `{ code, message }` the detached runner
 *  stores on the job, so the browser's pickErrorCode still recognizes it
 *  (mineru_auth / mineru_quota / mineru_timeout / …). A failed conversion is
 *  reported via the job-status endpoint (HTTP 200), so no HTTP status is
 *  carried here — the code is what matters. */
function mapConvertError(err: unknown): MappedConvertError {
  if (err instanceof MineruClientError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof MineruConvertError) {
    // Post-download ZIP/extraction failures. `too_large` is the only one the
    // user can act on (file bigger than our cap) — surface it as `mineru_input`.
    // The others are server-side malformations the user can't fix.
    if (err.code === "too_large") {
      return { code: "mineru_input", message: err.message };
    }
    return { code: "mineru_api", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "mineru_api", message };
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function notFound(res: ServerResponse): void {
  errorJson(res, 404, "not_found", "web route not found");
}

function errorJson(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { code, message } }));
}
