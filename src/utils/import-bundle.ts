// Browser-side equivalent of dikw-core/src/dikw_core/client/importer.py.
// Mirrors archive-path rules, manifest wire shape, and the package_sha256
// formula. Divergence shows up as ``manifest_package_sha256_mismatch`` from
// the server, so this file must stay aligned with the Python source of truth.

import { mergeFrontmatter } from "./frontmatter-merge";
import { kebabSourceName, kebabStem } from "./kebab-source-name";
import { extractAssetRefs, isRemoteRef, resolveAssetRef, stripFrontmatter } from "./md-asset-refs";
import { buildTar, splitUstarPath } from "./tar";

export { buildTar, splitUstarPath };

export const MD_EXTENSIONS: ReadonlySet<string> = new Set([".md"]);
export const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".pdf",
]);

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
  reason:
    | "unsupported_extension"
    | "empty_body"
    | "asset_missing"
    | "unreferenced_asset"
    | "duplicate_path"
    | "path_too_long";
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
  /** Maximum allowed total uncompressed bytes. Defaults to 256 MiB — the
   *  browser-realistic ceiling. Core itself accepts up to 1 GiB
   *  (``_DEFAULT_MAX_IMPORT_BYTES``) but we read every file fully into RAM
   *  twice (raw bytes + gzipped Blob) before POSTing, so anything close to
   *  that limit OOMs the tab. Streaming/spooling is a follow-up. */
  maxTotalBytes?: number;
}

const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

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
  // Detect collisions where two distinct ``File`` inputs strip to the same
  // project-rel path. Without this, mdPaths gets duplicate entries and the
  // server rejects the whole import with ``manifest_duplicate_md_path`` —
  // the user just sees 'Import failed' with no actionable detail.
  for (const file of files) {
    const rel = computeProjectRelPath(file);
    const ext = lowerExt(rel);
    if (byProjectRel.has(rel)) {
      const existing = byProjectRel.get(rel)!;
      // Only flag if it's actually a different File object — picking the
      // same File twice via two pickers should be a quiet no-op.
      if (existing !== file) {
        skipped.push({
          path: rel,
          reason: "duplicate_path",
          detail: `${existing.size}B vs ${file.size}B`,
        });
      }
      continue;
    }
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

/** Append a ``-N`` disambiguation suffix to a kebab stem, capping the result at
 *  28 code points so ``<stem>.md`` stays under 32. */
function appendSuffix(stem: string, n: number): string {
  const suffix = `-${n}`;
  const max = 28 - suffix.length;
  const capped = Array.from(stem).slice(0, max).join("").replace(/-+$/g, "");
  return `${capped}${suffix}`;
}

/** Normalize a scanned import: rename each markdown to a Unicode-kebab basename,
 *  number distinct names that collapse to the same kebab, and merge a flat
 *  ``original_filename`` into its frontmatter (a no-op when it is already there,
 *  e.g. a MinerU-converted file). Assets are carried through unchanged — a plain
 *  ``.md`` is renamed by basename only (its dir, and therefore its relative asset
 *  refs, are untouched), and a MinerU unit's kebab path is idempotent. Runs after
 *  ``scanFiles`` so same-raw-path duplicates are already resolved. See
 *  docs/adr/0004-source-import-normalization.md. */
export async function normalizeForImport(scan: ScanResult): Promise<ScanResult> {
  const byProjectRel = new Map<string, File>();
  const mdPaths: string[] = [];
  const taken = new Set<string>();
  const oldMd = new Set(scan.mdPaths);

  for (const mdPath of scan.mdPaths) {
    const slash = mdPath.lastIndexOf("/");
    const dir = slash < 0 ? "" : mdPath.slice(0, slash + 1); // keeps the trailing '/'
    const base = slash < 0 ? mdPath : mdPath.slice(slash + 1);
    const file = scan.byProjectRel.get(mdPath)!;

    let newPath = `${dir}${kebabSourceName(base)}`;
    for (let n = 2; taken.has(newPath); n++) {
      newPath = `${dir}${appendSuffix(kebabStem(base), n)}.md`;
    }
    taken.add(newPath);

    const merged = mergeFrontmatter(await file.text(), { original_filename: base });
    const newName = newPath.slice(newPath.lastIndexOf("/") + 1);
    byProjectRel.set(newPath, new File([merged], newName, { type: "text/markdown" }));
    mdPaths.push(newPath);
  }

  // Carry every non-markdown file (assets) through verbatim.
  for (const [path, file] of scan.byProjectRel) {
    if (oldMd.has(path)) continue;
    byProjectRel.set(path, file);
  }

  return { byProjectRel, mdPaths, skipped: [...scan.skipped] };
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
  assetShas: ReadonlyArray<string>,
): Promise<string> {
  const sorted = [mdSha, ...assetShas].slice().sort();
  return sha256HexString(sorted.join("\n"));
}

/** Inspect every md: extract refs, resolve them against the file inventory.
 *  Reports missing assets + empty-body cases via ``skipped`` and excludes
 *  those packages from the build. */
export async function inspectMarkdownFiles(scan: ScanResult): Promise<{
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
        available,
      });
      if (resolved === null) {
        // ``http(s)://`` / ``data:`` / other non-file schemes are silently
        // dropped — they're not local files. Anything else (including
        // ``file:`` URIs, which core's ``_is_remote`` treats as local) is a
        // genuine miss and gets reported.
        if (!isRemoteRef(ref.originalPath)) {
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
        detail: firstMissing,
      });
      continue;
    }
    packages.push({ mdProjectRel: mdRel, assetsProjectRel });
  }
  return { packages, skipped };
}

export async function gzip(bytes: Uint8Array): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw new Error(
      "CompressionStream is not available in this browser; please upgrade to Chrome 80+, Firefox 113+, or Safari 16.4+.",
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
  opts: BuildBundleOptions = {},
): Promise<ImportBundleResult> {
  const max = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const scan = await normalizeForImport(scanFiles(files));
  const { packages, skipped } = await inspectMarkdownFiles(scan);

  if (packages.length === 0) {
    throw new ImportBundleError(
      "no_packages",
      "No importable markdown files were found. Each .md must have a non-empty body and resolvable asset references.",
    );
  }

  // Collect every unique archive path that participates in any package.
  const projectRelByArchive = new Map<string, string>(); // archive → project-rel
  const referencedAssets = new Set<string>();
  for (const pkg of packages) {
    projectRelByArchive.set(archivePath(pkg.mdProjectRel), pkg.mdProjectRel);
    for (const a of pkg.assetsProjectRel) {
      projectRelByArchive.set(archivePath(a), a);
      referencedAssets.add(a);
    }
  }

  // Warn (but don't block) on assets the user selected that no md references.
  // Core's CLI importer rejects these outright; the web flow is more permissive
  // (the user may have selected a broad folder and we shouldn't force them to
  // unselect every loose image), so we surface them in ``skipped`` and leave
  // them out of the bundle — see CLAUDE.md / plan for the divergence rationale.
  for (const [projRel, file] of scan.byProjectRel) {
    const ext = lowerExt(projRel);
    if (!ASSET_EXTENSIONS.has(ext)) continue;
    if (referencedAssets.has(projRel)) continue;
    skipped.push({
      path: projRel,
      reason: "unreferenced_asset",
      detail: `${file.size}B`,
    });
  }

  // Hash + size each unique file once, in archive-path order so the manifest is
  // stable (matches importer.py:_build_bundle sorted iteration).
  const sortedArchive = Array.from(projectRelByArchive.keys()).sort();

  // Pre-flight: sum ``File.size`` (no I/O — the browser already knows the
  // sizes from the picker) and reject before loading anything into RAM. The
  // old code called ``await file.arrayBuffer()`` first and only then checked
  // ``totalBytes``, so a single oversized file could OOM the tab before the
  // limit fired.
  let totalBytes = 0;
  for (const archive of sortedArchive) {
    const projectRel = projectRelByArchive.get(archive)!;
    const file = scan.byProjectRel.get(projectRel)!;
    totalBytes += file.size;
  }
  if (totalBytes > max) {
    throw new ImportBundleError(
      "too_large",
      `Selected files total ${totalBytes} bytes, exceeding the ${max}-byte limit.`,
    );
  }

  const entries: Array<{ archivePath: string; data: Uint8Array; sha: string; size: number }> = [];
  for (const archive of sortedArchive) {
    const projectRel = projectRelByArchive.get(archive)!;
    const file = scan.byProjectRel.get(projectRel)!;
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const sha = await sha256Hex(buf);
    entries.push({ archivePath: archive, data, sha, size: data.length });
  }
  const shaByArchive = new Map(entries.map((e) => [e.archivePath, e.sha] as const));

  // Build manifest: files sorted by archive path; packages indexed by md order.
  const manifestFiles: ManifestFileEntry[] = entries.map((e) => ({
    path: e.archivePath,
    size: e.size,
    sha256: e.sha,
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
      package_sha256: pkgSha,
    });
  }

  const manifest: ManifestJson = {
    files: manifestFiles,
    packages: manifestPackages,
    total_bytes: totalBytes,
  };

  const tarBytes = buildTar(entries.map((e) => ({ archivePath: e.archivePath, data: e.data })));
  const payload = await gzip(tarBytes);

  return {
    payload,
    manifestJson: JSON.stringify(manifest),
    manifest,
    filesCount: entries.length,
    totalBytes,
    skipped,
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
