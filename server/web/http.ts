// Dispatcher for /web/* routes. Today: mineru convert + health. Future:
// other format converters / utility endpoints that don't belong in the
// chat agent's /agent namespace and aren't part of dikw-core's /v1
// contract.

import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { extname } from "node:path";
import { buildTar } from "../../src/utils/tar.js";
import { MineruClient, MineruClientError } from "./mineruClient.js";
import { extractResultZip, MineruConvertError } from "./mineruConvert.js";
import { loadWebConfig, type WebConfig } from "./config.js";

export interface WebHandlerOptions {
  cwd?: string;
  config?: WebConfig;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export async function createDefaultWebHandler(cwd = process.cwd()): Promise<WebHandler> {
  const config = await loadWebConfig({ cwd });
  return createWebHandler({ cwd, config });
}

export type WebHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void
) => Promise<void>;

export function createWebHandler(options: WebHandlerOptions = {}): WebHandler {
  const config = options.config ?? {};
  const fetchFn = options.fetch ?? globalThis.fetch;

  return async function webHandler(req, res, next) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "mineru") {
        return notFound(res);
      }
      if (req.method === "GET" && parts[1] === "health") {
        return json(res, {
          enabled: Boolean(config.mineruApiKey),
          hasKey: Boolean(config.mineruApiKey)
        });
      }
      if (req.method === "POST" && parts[1] === "convert") {
        if (!config.mineruApiKey) {
          return errorJson(res, 503, "mineru_disabled", "MinerUAPIKey is not configured on this sidecar");
        }
        return handleConvert(req, res, url, config.mineruApiKey, fetchFn);
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
  fetchFn: typeof fetch
): Promise<void> {
  const inputSha = url.searchParams.get("inputSha");
  if (!inputSha) {
    return errorJson(res, 400, "missing_input_sha", "inputSha query parameter is required");
  }
  let fileName: string;
  let fileBytes: Uint8Array;
  try {
    const part = await readMultipartFile(req);
    fileName = part.filename || `upload-${inputSha.slice(0, 8)}.bin`;
    fileBytes = part.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorJson(res, 400, "invalid_multipart", message);
  }

  // 200 MB hard cap (matches mineru's server-side limit; refusing here
  // means we don't waste an upload round-trip on something mineru would
  // reject anyway).
  if (fileBytes.byteLength > 200 * 1024 * 1024) {
    return errorJson(
      res,
      413,
      "mineru_input",
      `File ${JSON.stringify(fileName)} is ${fileBytes.byteLength} bytes, exceeds mineru's 200 MB cap`
    );
  }

  const ext = extname(fileName).toLowerCase();
  const modelVersion = ext === ".pdf" ? "vlm" : null;
  const stem = stemOf(fileName);
  const dataId = inputSha.slice(0, 32);

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const client = new MineruClient({
    token: apiKey,
    fetch: fetchFn,
    signal: controller.signal
  });

  try {
    const handle = await client.submit({ fileName, dataId, modelVersion });
    await client.upload(handle.uploadUrl, fileBytes);
    const zipUrl = await client.pollUntilDone(handle.batchId);
    const zipBytes = await client.downloadZip(zipUrl);
    const extracted = extractResultZip(zipBytes);
    const markdownWithFrontmatter = injectFrontmatter(
      extracted.markdown,
      fileName,
      inputSha
    );
    const tarBytes = buildResponseTar(stem, markdownWithFrontmatter, extracted.assets);
    const gz = gzipSync(tarBytes, { level: 9 });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-tar+gzip");
    res.setHeader("Content-Length", String(gz.byteLength));
    res.end(gz);
  } catch (err) {
    return convertErrorJson(res, err);
  }
}

function buildResponseTar(
  stem: string,
  markdown: string,
  assets: Map<string, Uint8Array>
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

function injectFrontmatter(markdown: string, originalFilename: string, inputSha: string): string {
  // Only deterministic keys so the resulting bundle is byte-stable for
  // identical inputs. No converted_at, no batch_id.
  const fm = [
    "---",
    "source:",
    `  converter: mineru`,
    `  original_filename: ${yamlSafe(originalFilename)}`,
    `  original_sha256: ${inputSha}`,
    "---",
    ""
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
  const body = await bufferRequest(req);
  return parseMultipartFile(body, ct);
}

async function bufferRequest(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
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
    if (
      body[cursor] === crlf[0] &&
      body[cursor + 1] === crlf[1]
    ) {
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
        mediaType: ctMatch ? ctMatch[1].trim() : "application/octet-stream"
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

function convertErrorJson(res: ServerResponse, err: unknown): void {
  if (err instanceof MineruClientError) {
    const status = mineruStatus(err.code);
    return errorJson(res, status, err.code, err.message);
  }
  if (err instanceof MineruConvertError) {
    return errorJson(res, 502, "mineru_api", err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorJson(res, 500, "mineru_api", message);
}

function mineruStatus(code: string): number {
  switch (code) {
    case "mineru_auth":
      return 401;
    case "mineru_input":
      return 413;
    case "mineru_quota":
      return 429;
    case "mineru_timeout":
      return 504;
    default:
      return 502;
  }
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
