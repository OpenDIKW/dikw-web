// Browser-side equivalent of dikw-core/src/dikw_core/client/importer.py.
// Mirrors archive-path rules, manifest wire shape, and the package_sha256
// formula. Divergence shows up as ``manifest_package_sha256_mismatch`` from
// the server, so this file must stay aligned with the Python source of truth.

import {
  extractAssetRefs,
  resolveAssetRef,
  stripFrontmatter
} from "./md-asset-refs";

export const MD_EXTENSIONS: ReadonlySet<string> = new Set([".md"]);
export const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".pdf"
]);

const TAR_BLOCK = 512;
const NAME_FIELD_MAX = 100;

export interface ManifestFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ManifestPackageEntry {
  id: number;
  md_path: string;
  asset_paths: string[];
  package_sha256: string;
}

export interface ManifestJson {
  files: ManifestFileEntry[];
  packages: ManifestPackageEntry[];
  total_bytes: number;
}

export interface SkippedFile {
  path: string;
  reason: "unsupported_extension" | "empty_body" | "asset_missing";
  detail?: string;
}

export interface ImportBundleResult {
  payload: Blob;
  manifestJson: string;
  manifest: ManifestJson;
  filesCount: number;
  totalBytes: number;
  skipped: SkippedFile[];
}

export interface BuildBundleOptions {
  /** Maximum allowed total uncompressed bytes — defaults to 1 GiB, matching
   *  core's ``_DEFAULT_MAX_IMPORT_BYTES``. */
  maxTotalBytes?: number;
}

const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export function lowerExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Strip the common top-level directory segment from every file's
 *  ``webkitRelativePath``. When users pick a folder via ``webkitdirectory``
 *  the picked folder itself is included as the first segment, and we treat
 *  the *contents* as the project root.
 *
 *  For files picked through ``<input multiple>`` (no relative path), the
 *  bare filename is used. */
export function computeProjectRelPath(file: File): string {
  const raw = file.webkitRelativePath || file.name;
  // Normalize separators just in case (some browsers / shells use ``\``).
  const norm = raw.replace(/\\+/g, "/");
  const slash = norm.indexOf("/");
  if (slash < 0) return norm;
  return norm.slice(slash + 1);
}

export function archivePath(projectRel: string): string {
  if (projectRel === "sources" || projectRel.startsWith("sources/")) {
    return projectRel;
  }
  return "sources/" + projectRel;
}

export interface ScanResult {
  /** Map from project-relative path → File, for every file we consider
   *  (md + asset; unsupported extensions are skipped). */
  byProjectRel: Map<string, File>;
  /** Project-relative paths of all .md files, in insertion order. */
  mdPaths: string[];
  skipped: SkippedFile[];
}

export function scanFiles(files: File[]): ScanResult {
  const byProjectRel = new Map<string, File>();
  const mdPaths: string[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const rel = computeProjectRelPath(file);
    const ext = lowerExt(rel);
    if (MD_EXTENSIONS.has(ext)) {
      byProjectRel.set(rel, file);
      mdPaths.push(rel);
    } else if (ASSET_EXTENSIONS.has(ext)) {
      byProjectRel.set(rel, file);
    } else {
      skipped.push({ path: rel, reason: "unsupported_extension" });
    }
  }
  return { byProjectRel, mdPaths, skipped };
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // ``crypto.subtle.digest`` accepts BufferSource (ArrayBuffer | ArrayBufferView)
  // but the new ``Uint8Array<ArrayBufferLike>`` typing in TS 5.7+ doesn't satisfy
  // the older ``BufferSource`` union (SharedArrayBuffer variance). Build a
  // copy on a fresh ArrayBuffer to keep the type precise.
  const len = bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  if (bytes instanceof Uint8Array) {
    view.set(bytes);
  } else {
    view.set(new Uint8Array(bytes));
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return hex(new Uint8Array(digest));
}

export async function sha256HexString(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** ``sha256( sorted([mdSha, *assetShas]).join("\n").encode("ascii") )``
 *  — must agree byte-for-byte with ``md_inspect.package_sha256``. */
export function computePackageSha256(
  mdSha: string,
  assetShas: ReadonlyArray<string>
): Promise<string> {
  const sorted = [mdSha, ...assetShas].slice().sort();
  return sha256HexString(sorted.join("\n"));
}

/** Inspect every md: extract refs, resolve them against the file inventory.
 *  Reports missing assets + empty-body cases via ``skipped`` and excludes
 *  those packages from the build. */
export async function inspectMarkdownFiles(
  scan: ScanResult
): Promise<{
  packages: Array<{ mdProjectRel: string; assetsProjectRel: string[] }>;
  skipped: SkippedFile[];
}> {
  const skipped = [...scan.skipped];
  const packages: Array<{ mdProjectRel: string; assetsProjectRel: string[] }> = [];
  const available = new Set(scan.byProjectRel.keys());

  for (const mdRel of scan.mdPaths) {
    const file = scan.byProjectRel.get(mdRel)!;
    const text = await file.text();
    const body = stripFrontmatter(text);
    if (body.trim().length === 0) {
      skipped.push({ path: mdRel, reason: "empty_body" });
      continue;
    }
    const refs = extractAssetRefs(body);
    const seen = new Set<string>();
    const assetsProjectRel: string[] = [];
    let firstMissing: string | null = null;
    for (const ref of refs) {
      const resolved = resolveAssetRef(ref.originalPath, {
        mdRelPath: mdRel,
        available
      });
      if (resolved === null) {
        // ``http://``/``https://``/``data:`` are silently dropped — they're not
        // local files. Genuine misses are reported.
        if (!/^([a-zA-Z][a-zA-Z0-9+\-.]*):/.test(ref.originalPath)) {
          if (firstMissing === null) firstMissing = ref.originalPath;
        }
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      assetsProjectRel.push(resolved);
    }
    if (firstMissing !== null) {
      skipped.push({
        path: mdRel,
        reason: "asset_missing",
        detail: firstMissing
      });
      continue;
    }
    packages.push({ mdProjectRel: mdRel, assetsProjectRel });
  }
  return { packages, skipped };
}

// ---- USTAR writer ---------------------------------------------------------
//
// Format reference: https://www.gnu.org/software/tar/manual/html_node/Standard.html
// Header fields we write explicitly: name, mode, size, mtime, chksum, typeflag,
// magic, version. Everything else stays zero-filled. We strip uid/gid/uname/gname
// to keep the archive byte-stable across users (mirrors importer.py's choice).

function writeOctal(view: Uint8Array, offset: number, length: number, value: number): void {
  // tar uses null-terminated octal; the field length includes the terminator.
  const oct = value.toString(8);
  if (oct.length > length - 1) {
    throw new Error(`tar field overflow: octal ${oct} does not fit in ${length} bytes`);
  }
  const padded = oct.padStart(length - 1, "0");
  for (let i = 0; i < padded.length; i++) {
    view[offset + i] = padded.charCodeAt(i);
  }
  view[offset + length - 1] = 0;
}

function writeAscii(view: Uint8Array, offset: number, length: number, value: string): void {
  // Tar ``name`` and ``magic`` are byte-fields. Reject names that don't fit
  // ASCII (UTF-8 byte length > field length). Non-ASCII filenames are technically
  // representable but require POSIX 1003.1-2001 extended headers — out of scope
  // for v1.
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) {
    throw new Error(
      `tar field overflow: ${JSON.stringify(value)} exceeds ${length} bytes`
    );
  }
  for (let i = 0; i < bytes.length; i++) {
    view[offset + i] = bytes[i];
  }
}

function ustarHeader(archivePath: string, size: number): Uint8Array {
  if (new TextEncoder().encode(archivePath).length > NAME_FIELD_MAX) {
    throw new Error(
      `archive path too long for USTAR (max ${NAME_FIELD_MAX} bytes): ${archivePath}`
    );
  }
  const header = new Uint8Array(TAR_BLOCK);
  writeAscii(header, 0, 100, archivePath); // name
  writeOctal(header, 100, 8, 0o644); // mode
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, size); // size
  writeOctal(header, 136, 12, 0); // mtime (zeroed for byte-stability)
  // chksum field: filled with spaces before computing, then re-written.
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30; // typeflag '0' = regular file
  // magic + version: "ustar\0" then "00"
  writeAscii(header, 257, 6, "ustar\0");
  header[263] = 0x30;
  header[264] = 0x30;
  // Compute checksum: unsigned sum of every byte (with chksum field = spaces).
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  // Write back: 6-digit octal, NUL, then space. Note this is the standard
  // tar checksum encoding (not the usual ``writeOctal`` shape).
  const oct = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) header[148 + i] = oct.charCodeAt(i);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export function buildTar(
  entries: Array<{ archivePath: string; data: Uint8Array }>
): Uint8Array {
  let total = 0;
  for (const e of entries) {
    total += TAR_BLOCK; // header
    total += Math.ceil(e.data.length / TAR_BLOCK) * TAR_BLOCK; // padded data
  }
  total += TAR_BLOCK * 2; // two end-of-archive zero blocks

  const out = new Uint8Array(total);
  let pos = 0;
  for (const e of entries) {
    const header = ustarHeader(e.archivePath, e.data.length);
    out.set(header, pos);
    pos += TAR_BLOCK;
    out.set(e.data, pos);
    pos += e.data.length;
    const pad = (TAR_BLOCK - (e.data.length % TAR_BLOCK)) % TAR_BLOCK;
    pos += pad; // already zeros
  }
  // Final 2 blocks are already zero-filled by Uint8Array's default.
  return out;
}

export async function gzip(bytes: Uint8Array): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw new Error(
      "CompressionStream is not available in this browser; please upgrade to Chrome 80+, Firefox 113+, or Safari 16.4+."
    );
  }
  // Don't go through Blob.stream() — jsdom's Blob doesn't implement it. The
  // Response(BufferSource).body ReadableStream is the portable path. Wrap in
  // a Blob to satisfy ``BodyInit`` in the TS 5.7+ DOM typings (Uint8Array's
  // generic ArrayBufferLike doesn't satisfy the older BufferSource union).
  // BlobPart requires an ArrayBuffer-backed view; copy to a fresh buffer.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const source = new Response(new Blob([buf])).body!;
  const compressed = source.pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).blob();
}

// ---- Top-level builder ----------------------------------------------------

export async function buildImportBundle(
  files: File[],
  opts: BuildBundleOptions = {}
): Promise<ImportBundleResult> {
  const max = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const scan = scanFiles(files);
  const { packages, skipped } = await inspectMarkdownFiles(scan);

  if (packages.length === 0) {
    throw new ImportBundleError(
      "no_packages",
      "No importable markdown files were found. Each .md must have a non-empty body and resolvable asset references."
    );
  }

  // Collect every unique archive path that participates in any package.
  const projectRelByArchive = new Map<string, string>(); // archive → project-rel
  for (const pkg of packages) {
    projectRelByArchive.set(archivePath(pkg.mdProjectRel), pkg.mdProjectRel);
    for (const a of pkg.assetsProjectRel) {
      projectRelByArchive.set(archivePath(a), a);
    }
  }

  // Hash + size each unique file once, in archive-path order so the manifest is
  // stable (matches importer.py:_build_bundle sorted iteration).
  const sortedArchive = Array.from(projectRelByArchive.keys()).sort();
  const entries: Array<{ archivePath: string; data: Uint8Array; sha: string; size: number }> = [];
  let totalBytes = 0;
  for (const archive of sortedArchive) {
    const projectRel = projectRelByArchive.get(archive)!;
    const file = scan.byProjectRel.get(projectRel)!;
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const sha = await sha256Hex(buf);
    totalBytes += data.length;
    if (totalBytes > max) {
      throw new ImportBundleError(
        "too_large",
        `Selected files total ${totalBytes} bytes, exceeding the ${max}-byte limit.`
      );
    }
    entries.push({ archivePath: archive, data, sha, size: data.length });
  }
  const shaByArchive = new Map(entries.map((e) => [e.archivePath, e.sha] as const));

  // Build manifest: files sorted by archive path; packages indexed by md order.
  const manifestFiles: ManifestFileEntry[] = entries.map((e) => ({
    path: e.archivePath,
    size: e.size,
    sha256: e.sha
  }));

  const manifestPackages: ManifestPackageEntry[] = [];
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const mdArchive = archivePath(pkg.mdProjectRel);
    const assetArchives = pkg.assetsProjectRel.map(archivePath);
    const mdSha = shaByArchive.get(mdArchive)!;
    const assetShas = assetArchives.map((a) => shaByArchive.get(a)!);
    const pkgSha = await computePackageSha256(mdSha, assetShas);
    manifestPackages.push({
      id: i,
      md_path: mdArchive,
      asset_paths: assetArchives,
      package_sha256: pkgSha
    });
  }

  const manifest: ManifestJson = {
    files: manifestFiles,
    packages: manifestPackages,
    total_bytes: totalBytes
  };

  const tarBytes = buildTar(
    entries.map((e) => ({ archivePath: e.archivePath, data: e.data }))
  );
  const payload = await gzip(tarBytes);

  return {
    payload,
    manifestJson: JSON.stringify(manifest),
    manifest,
    filesCount: entries.length,
    totalBytes,
    skipped
  };
}

export class ImportBundleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImportBundleError";
    this.code = code;
  }
}
