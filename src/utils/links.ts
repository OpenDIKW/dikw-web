import type { DerivedPage, DocumentRecord, IncomingLink, Layer } from "../types";
import { displayTitle } from "./format";

export interface BacklinkRef {
  path: string;
  title: string;
  layer: Layer;
}

export type SourceTag = "linked" | "sourced";

export interface SourceReference extends BacklinkRef {
  sources: SourceTag[];
}

/**
 * Resolve the `incoming[]` edges from `GET /v1/base/pages/{path}/links` into
 * displayable backlink references. Core returns only `src_path` per edge, so we
 * join against the already-loaded base page list to recover title and layer,
 * deduping multiple edges from the same source page. Links whose source is not
 * an active page are dropped; an optional `layers` filter keeps only the wanted
 * layers (e.g. wiki/wisdom).
 */
export function resolveBacklinks(
  incoming: IncomingLink[],
  pages: DocumentRecord[],
  opts?: { layers?: Layer[] }
): BacklinkRef[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const seen = new Set<string>();
  const refs: BacklinkRef[] = [];

  for (const link of incoming) {
    if (seen.has(link.src_path)) {
      continue;
    }
    const doc = byPath.get(link.src_path);
    if (!doc || !doc.active) {
      continue;
    }
    if (opts?.layers && !opts.layers.includes(doc.layer)) {
      continue;
    }
    seen.add(link.src_path);
    refs.push({
      path: doc.path,
      title: displayTitle(doc),
      layer: doc.layer
    });
  }

  refs.sort((a, b) => (a.layer === b.layer ? a.title.localeCompare(b.title) : a.layer.localeCompare(b.layer)));
  return refs;
}

/**
 * Resolve the `derived_pages[]` from `GET /v1/base/pages/{path}/provenance` (a
 * reverse edge driven by K-page frontmatter `sources:`) into the same
 * `BacklinkRef` shape used by body wikilink backlinks, so the merger can union
 * them without reshaping. Same join + active + dedupe model as resolveBacklinks.
 */
export function resolveDerivedPages(derived: DerivedPage[], pages: DocumentRecord[]): BacklinkRef[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const seen = new Set<string>();
  const refs: BacklinkRef[] = [];

  for (const entry of derived) {
    if (seen.has(entry.path)) {
      continue;
    }
    const doc = byPath.get(entry.path);
    if (!doc || !doc.active) {
      continue;
    }
    seen.add(entry.path);
    refs.push({ path: doc.path, title: displayTitle(doc), layer: doc.layer });
  }

  refs.sort((a, b) => (a.layer === b.layer ? a.title.localeCompare(b.title) : a.layer.localeCompare(b.layer)));
  return refs;
}

/**
 * Union backlinks (body `[[wikilink]]`) and provenance-derived pages (K-page
 * frontmatter `sources:`) by path. Each entry gets a `sources` tag list — a
 * double-evidence reference (`["linked", "sourced"]`) is sorted above
 * single-evidence ones. Within the same evidence tier, layer then title sort
 * matches resolveBacklinks for visual consistency.
 */
export function mergeSourceReferences(linked: BacklinkRef[], sourced: BacklinkRef[]): SourceReference[] {
  const byPath = new Map<string, SourceReference>();

  for (const ref of linked) {
    byPath.set(ref.path, { ...ref, sources: ["linked"] });
  }
  for (const ref of sourced) {
    const existing = byPath.get(ref.path);
    if (existing) {
      existing.sources = ["linked", "sourced"];
    } else {
      byPath.set(ref.path, { ...ref, sources: ["sourced"] });
    }
  }

  const merged = Array.from(byPath.values());
  merged.sort((a, b) => {
    const aDouble = a.sources.length === 2 ? 0 : 1;
    const bDouble = b.sources.length === 2 ? 0 : 1;
    if (aDouble !== bDouble) {
      return aDouble - bDouble;
    }
    if (a.layer !== b.layer) {
      return a.layer.localeCompare(b.layer);
    }
    return a.title.localeCompare(b.title);
  });
  return merged;
}
