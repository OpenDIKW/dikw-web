// MinerU result-ZIP extraction + markdown image-ref rewriting. Ported
// behavior-for-behavior from dikw-plugins/.../_zip_extract.py.
//
// The result ZIP is well-formed (server-generated) so we self-parse a
// minimal subset (Method 0 stored + Method 8 deflate, no ZIP64, no
// encryption, no data descriptors) instead of pulling in a deps. The
// caller (mineruClient) already caps download size at 256 MB before we
// see the buffer; we additionally cap per-entry and cumulative
// uncompressed sizes to defend against decompression bombs.

import { inflateRawSync } from "node:zlib";

const FULL_MD = "full.md";

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".bmp"
]);
const ASSET_EXTS = new Set([...IMAGE_EXTS, ".pdf"]);

export const MAX_ENTRY_UNCOMPRESSED = 64 * 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED = 512 * 1024 * 1024;

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const FLAG_UTF8_NAME = 0x0800;
const FLAG_DATA_DESCRIPTOR = 0x0008;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export type MineruConvertErrorCode =
  | "invalid_zip"
  | "missing_full_md"
  | "too_large"
  | "unsupported_method";

export class MineruConvertError extends Error {
  readonly code: MineruConvertErrorCode;
  constructor(code: MineruConvertErrorCode, message: string) {
    super(message);
    this.name = "MineruConvertError";
    this.code = code;
  }
}

export interface ExtractedResult {
  markdown: string;
  /** "assets/<relpath>" keys; matches what dikw-core's md_inspect expects. */
  assets: Map<string, Uint8Array>;
}

export interface ZipEntry {
  name: string;
  /** Bytes after decompression. */
  data: Uint8Array;
}

// ---------------------------------------------------------------- ZIP reader

function findEocd(buf: Uint8Array): number {
  // EOCD is at most 22 + 0xFFFF (max comment) = 65557 bytes from the end.
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = Math.max(0, buf.byteLength - 65_557);
  for (let i = buf.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      return i;
    }
  }
  return -1;
}

interface CentralEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readCentralDirectory(buf: Uint8Array): CentralEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(buf);
  if (eocd < 0) {
    throw new MineruConvertError("invalid_zip", "ZIP end-of-central-directory record not found");
  }
  const entryCount = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (cdOffset + 46 > buf.byteLength) {
      throw new MineruConvertError("invalid_zip", "ZIP central directory truncated");
    }
    const sig = view.getUint32(cdOffset, true);
    if (sig !== SIG_CD) {
      throw new MineruConvertError("invalid_zip", `unexpected ZIP central directory signature at offset ${cdOffset}`);
    }
    const flags = view.getUint16(cdOffset + 8, true);
    const method = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const uncompressedSize = view.getUint32(cdOffset + 24, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new MineruConvertError("invalid_zip", "ZIP64 entries are not supported");
    }
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const nameStart = cdOffset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buf.byteLength) {
      throw new MineruConvertError("invalid_zip", "ZIP central directory entry name overruns buffer");
    }
    const isUtf8 = (flags & FLAG_UTF8_NAME) !== 0;
    const name = decodeName(buf.subarray(nameStart, nameEnd), isUtf8);
    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    cdOffset = nameEnd + extraLen + commentLen;
  }
  return entries;
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  // CP437 fallback for older ZIPs. Falls back to latin-1 for missing chars —
  // close enough for ASCII-only filenames which is the common case.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readLocalEntry(buf: Uint8Array, entry: CentralEntry): Uint8Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lfh = entry.localHeaderOffset;
  if (lfh + 30 > buf.byteLength) {
    throw new MineruConvertError("invalid_zip", `local file header for ${entry.name} truncated`);
  }
  const sig = view.getUint32(lfh, true);
  if (sig !== SIG_LFH) {
    throw new MineruConvertError("invalid_zip", `unexpected local file header signature at offset ${lfh}`);
  }
  const nameLen = view.getUint16(lfh + 26, true);
  const extraLen = view.getUint16(lfh + 28, true);
  const dataStart = lfh + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.byteLength) {
    throw new MineruConvertError("invalid_zip", `compressed data for ${entry.name} truncated`);
  }
  const slice = buf.subarray(dataStart, dataEnd);
  if (entry.method === METHOD_STORED) {
    if (slice.byteLength !== entry.uncompressedSize) {
      throw new MineruConvertError(
        "invalid_zip",
        `stored entry ${entry.name} size mismatch: ${slice.byteLength} vs ${entry.uncompressedSize}`
      );
    }
    return slice.slice();
  }
  if (entry.method === METHOD_DEFLATE) {
    const out = inflateRawSync(slice);
    if (out.byteLength !== entry.uncompressedSize) {
      throw new MineruConvertError(
        "invalid_zip",
        `deflate entry ${entry.name} expanded to ${out.byteLength} bytes, expected ${entry.uncompressedSize}`
      );
    }
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  if ((entry.flags & FLAG_DATA_DESCRIPTOR) !== 0) {
    // Sizes are after the data — we'd need to scan for the descriptor sig
    // to find the end. Mineru's server doesn't emit these, so refuse rather
    // than implement.
    throw new MineruConvertError(
      "unsupported_method",
      `ZIP entry ${entry.name} uses data descriptor (general-purpose bit 3); not supported`
    );
  }
  throw new MineruConvertError(
    "unsupported_method",
    `ZIP entry ${entry.name} uses unsupported compression method ${entry.method}`
  );
}

export function readZip(zipBytes: Uint8Array): ZipEntry[] {
  const central = readCentralDirectory(zipBytes);
  const out: ZipEntry[] = [];
  for (const c of central) {
    out.push({ name: c.name, data: readLocalEntry(zipBytes, c) });
  }
  return out;
}

// ------------------------------------------------------------- path safety

export function safeRelpath(rawName: string): string | null {
  if (!rawName || rawName.endsWith("/")) return null;
  const converted = rawName.replace(/\\+/g, "/");
  // Lightweight posixpath.normpath: collapse "//", "/./", and "a/b/.." → "a".
  // Walk segments left-to-right.
  const parts = converted.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (stack.length === 0) return null; // escape attempt
      stack.pop();
      continue;
    }
    if (p.includes(":")) return null; // Windows drive / ADS
    stack.push(p);
  }
  if (stack.length === 0) return null;
  if (converted.startsWith("/")) return null;
  let joined = stack.join("/");
  joined = joined.replace(/[\]|]/g, "_");
  return joined.replace(/^\/+/, "");
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i).toLowerCase();
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

// -------------------------------------------------- markdown ref rewriting

const MD_IMAGE_RE =
  /!\[(?<altStd>[^\]]*?)\]\(\s*(?<pathStd>[^)\n]+?)(?=\s+"[^"\n]*"\s*\)|\s*\))(?:\s+"[^"\n]*")?\s*\)|!\[\[(?<pathWiki>[^|\]]+?)(?:\|(?<altWiki>[^\]]*?))?\]\]/g;

function sanitizeAssetName(name: string): string {
  let safe = name.replace(/\\+/g, "/");
  safe = safe.replace(/[\]|]/g, "_");
  return safe.replace(/^\/+/, "");
}

function wikilink(relPath: string, alt: string | null | undefined): string {
  const safeAlt = (alt ?? "").replace(/[\]|]/g, " ").trim();
  return safeAlt ? `![[${relPath}|${safeAlt}]]` : `![[${relPath}]]`;
}

function normalizeMdRef(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const cleaned = sanitizeAssetName(decoded);
  const safe = safeRelpath(cleaned);
  return safe ?? cleaned;
}

function isExternalRef(raw: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  // scheme: http://, https://, data:, file:, etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return true;
  // protocol-relative //example.com/...
  if (raw.startsWith("//") || decoded.startsWith("//")) return true;
  return false;
}

interface RewriteResult {
  markdown: string;
  referenced: Set<string>;
}

function rewriteImageRefs(md: string, assetMap: Map<string, string>): RewriteResult {
  const byRelpath = new Map<string, string>();
  const byRelpathFolded = new Map<string, string[]>();
  const byBasename = new Map<string, string[]>();
  const byBasenameFolded = new Map<string, string[]>();
  for (const [relpath, assetPath] of assetMap) {
    byRelpath.set(relpath, assetPath);
    const folded = relpath.toLowerCase();
    if (!byRelpathFolded.has(folded)) byRelpathFolded.set(folded, []);
    byRelpathFolded.get(folded)!.push(assetPath);
    const base = basenameOf(relpath);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base)!.push(assetPath);
    const baseFolded = base.toLowerCase();
    if (!byBasenameFolded.has(baseFolded)) byBasenameFolded.set(baseFolded, []);
    byBasenameFolded.get(baseFolded)!.push(assetPath);
  }
  const referenced = new Set<string>();
  const uniqueOrNull = (candidates: string[] | undefined, alt: string | null | undefined): string | null => {
    if (!candidates || candidates.length !== 1) return null;
    referenced.add(candidates[0]);
    return wikilink(candidates[0], alt);
  };
  const rewritten = md.replace(MD_IMAGE_RE, (match, ..._args) => {
    // RegExp.replace with named groups — pull the last arg.
    const groups = _args[_args.length - 1] as Record<string, string | undefined>;
    const raw = (groups.pathStd ?? groups.pathWiki ?? "").trim();
    const alt = groups.altStd ?? groups.altWiki ?? null;
    if (!raw) return match;
    if (isExternalRef(raw)) return match;
    const cleaned = normalizeMdRef(raw);
    const exact = byRelpath.get(cleaned);
    if (exact) {
      referenced.add(exact);
      return wikilink(exact, alt);
    }
    let result = uniqueOrNull(byRelpathFolded.get(cleaned.toLowerCase()), alt);
    if (result !== null) return result;
    const base = basenameOf(cleaned);
    result = uniqueOrNull(byBasename.get(base), alt);
    if (result !== null) return result;
    result = uniqueOrNull(byBasenameFolded.get(base.toLowerCase()), alt);
    if (result !== null) return result;
    return match;
  });
  return { markdown: rewritten, referenced };
}

// ----------------------------------------------------------- public extract

export function extractResultZip(zipBytes: Uint8Array): ExtractedResult {
  const entries = readZip(zipBytes);
  let markdown: string | null = null;
  const assetData = new Map<string, Uint8Array>(); // "assets/<relpath>" → bytes
  const assetMap = new Map<string, string>(); // normalized relpath → "assets/<relpath>"
  let cumulative = 0;

  for (const entry of entries) {
    if (entry.data.byteLength > MAX_ENTRY_UNCOMPRESSED) {
      throw new MineruConvertError(
        "too_large",
        `ZIP entry ${JSON.stringify(entry.name)} is ${entry.data.byteLength} bytes uncompressed, exceeds per-entry cap ${MAX_ENTRY_UNCOMPRESSED}`
      );
    }
    cumulative += entry.data.byteLength;
    if (cumulative > MAX_TOTAL_UNCOMPRESSED) {
      throw new MineruConvertError(
        "too_large",
        `ZIP cumulative uncompressed size exceeds ${MAX_TOTAL_UNCOMPRESSED} bytes`
      );
    }
    const relpath = safeRelpath(entry.name);
    if (relpath === null) continue;
    if (relpath === FULL_MD) {
      if (markdown === null) {
        // Strip trailing CRLFs and stray BOM.
        let text = new TextDecoder("utf-8").decode(entry.data);
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        markdown = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }
      continue;
    }
    if (!ASSET_EXTS.has(extOf(relpath))) continue;
    if (assetMap.has(relpath)) continue;
    const key = `assets/${relpath}`;
    assetMap.set(relpath, key);
    assetData.set(key, entry.data);
  }

  if (markdown === null) {
    const sample = entries
      .map((e) => e.name)
      .slice(0, 10)
      .join(", ");
    throw new MineruConvertError(
      "missing_full_md",
      `ZIP did not contain full.md at root (entries: ${sample}…)`
    );
  }

  const { markdown: rewritten, referenced } = rewriteImageRefs(markdown, assetMap);
  const finalAssets = new Map<string, Uint8Array>();
  for (const [k, v] of assetData) {
    if (referenced.has(k)) finalAssets.set(k, v);
  }
  const trailingNewlineMarkdown = rewritten.endsWith("\n") ? rewritten : rewritten + "\n";
  return { markdown: trailingNewlineMarkdown, assets: finalAssets };
}
