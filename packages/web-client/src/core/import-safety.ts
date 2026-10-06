import type { DocumentRecord, PageReadResult, RejectedPackage } from "../types/index.js";
import { gzip, sha256HexString, type ManifestJson } from "../import/import-bundle.js";
import {
  extractAssetRefs,
  isRemoteRef,
  posixJoinNormalize,
  stripFrontmatter,
} from "../import/md-asset-refs.js";
import { buildTar } from "../import/tar.js";
import { readTar, type TarEntry } from "../import/tar-reader.js";

export interface AssetProtection {
  existing_path?: string;
  original_ref?: string;
}

export function protectReferencedAssets(
  page: PageReadResult,
  incoming: Set<string>,
  protectedPaths: Map<string, AssetProtection>,
): void {
  for (const ref of extractAssetRefs(page.body)) {
    if (isRemoteRef(ref.originalPath)) continue;
    if (ref.originalPath.startsWith("/")) {
      // Core resolves local absolute paths against its filesystem, which HTTP
      // consumers cannot inspect. Any incoming asset might replace that target.
      for (const path of incoming)
        protectedPaths.set(path, { existing_path: page.path, original_ref: ref.originalPath });
      continue;
    }
    const mdDir = page.path.slice(0, Math.max(0, page.path.lastIndexOf("/")));
    // The new archive cannot tell us which existing Core candidate was used.
    // Protect every incoming sibling/root candidate, including sources/ prefixes.
    for (const base of [mdDir, "", "sources"]) {
      const candidate = posixJoinNormalize(base, ref.originalPath);
      if (!candidate.startsWith("..") && incoming.has(candidate) && !protectedPaths.has(candidate))
        protectedPaths.set(candidate, {});
    }
  }
}

/** Core 0.6.9 replaces matching paths. Reject indexed source collisions before
 * submitting; this is a preflight, not an atomic server-side write guard. */
export async function prepareImport(
  payload: Blob,
  manifest: ManifestJson,
  pages: DocumentRecord[],
  protectedAssets: Map<string, AssetProtection>,
): Promise<{
  payload: Blob | null;
  manifest: ManifestJson;
  rejected: RejectedPackage[];
  warnings: RejectedPackage[];
}> {
  const paths = new Set(pages.map((page) => page.path));
  const rejected: RejectedPackage[] = [];
  const warnings: RejectedPackage[] = [];
  const packages = manifest.packages.filter((pkg) => {
    if (paths.has(pkg.md_path)) {
      rejected.push({
        id: pkg.id,
        code: "source_path_exists",
        detail: { md_path: pkg.md_path, existing_path: pkg.md_path },
      });
      return false;
    }
    const asset = pkg.asset_paths.find((path) => protectedAssets.has(path) || paths.has(path));
    if (asset) {
      const protection = protectedAssets.get(asset);
      rejected.push({
        id: pkg.id,
        code: protection?.original_ref ? "source_asset_scope_unknown" : "source_asset_exists",
        detail: { md_path: pkg.md_path, asset_path: asset, ...protection },
      });
      return false;
    }
    return true;
  });
  if (pages.length === 0) return { payload, manifest, rejected, warnings };
  const retained = new Set(packages.flatMap((pkg) => [pkg.md_path, ...pkg.asset_paths]));
  const files = manifest.files.filter((file) => retained.has(file.path));
  const filtered = {
    files,
    packages,
    total_bytes: files.reduce((sum, file) => sum + file.size, 0),
  };
  if (packages.length === 0) return { payload: null, manifest: filtered, rejected, warnings };
  let entries: TarEntry[];
  try {
    const tar = new Uint8Array(
      await new Response(
        payload.stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    entries = readTar(tar).filter((entry) => retained.has(entry.archivePath));
  } catch (err) {
    // Warning inspection is optional; Core accepts more tar variants than our
    // conversion reader. Forward unchanged when no protected path would be written.
    if (rejected.length === 0) return { payload, manifest, rejected, warnings };
    // Filtering an unsupported tar cannot safely preserve Core's semantics.
    // Reject the remainder rather than accidentally forward the conflicting files.
    for (const pkg of packages)
      rejected.push({
        id: pkg.id,
        code: "unsupported_safe_import_archive",
        detail: { md_path: pkg.md_path, message: err instanceof Error ? err.message : String(err) },
      });
    return {
      payload: null,
      manifest: { files: [], packages: [], total_bytes: 0 },
      rejected,
      warnings,
    };
  }
  const data = new Map(entries.map((entry) => [entry.archivePath, entry.data]));
  const byHash = new Map(pages.map((page) => [page.hash, page.path]));
  for (const pkg of packages) {
    const bytes = data.get(pkg.md_path);
    if (!bytes) continue; // Core validates missing manifest files.
    const body = stripFrontmatter(new TextDecoder().decode(bytes)).replace(/\r\n/g, "\n").trim();
    const existing = byHash.get(await sha256HexString(body));
    if (existing)
      warnings.push({
        id: pkg.id,
        code: "source_content_matches",
        detail: { md_path: pkg.md_path, existing_path: existing },
      });
  }
  if (rejected.length === 0) return { payload, manifest, rejected, warnings };
  const bytes = buildTar(entries);
  const compressed = await gzip(bytes);
  return { payload: compressed, manifest: filtered, rejected, warnings };
}
