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
 * layers (e.g. knowledge/wisdom).
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
 * them without reshaping. Same join + dedupe model as resolveBacklinks, but
 * the API actually returns a usable title alongside doc_id, so when the
 * cached `pages.data` list lags behind a freshly-synthesized K-page we still
 * render the entry using the wire title rather than silently dropping it.
 *
 * The `opts.layers` filter is intentionally omitted: provenance edges always
 * point at K-pages (knowledge / wisdom) per the core contract, so callers never
 * need to filter to a subset.
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
    if (doc && !doc.active) {
      continue;
    }
    seen.add(entry.path);
    if (doc) {
      refs.push({ path: doc.path, title: displayTitle(doc), layer: doc.layer });
    } else {
      // pages.data hasn't caught up with this K-page yet; render with the
      // wire title and a path-inferred layer. provenance edges only point
      // at knowledge / wisdom per the core contract, so a `wisdom/` prefix
      // signals wisdom and everything else defaults to knowledge. The reader
      // will get the exact layer back when the next pages reload lands.
      const fallbackLayer: Layer = entry.path.startsWith("wisdom/") ? "wisdom" : "knowledge";
      refs.push({ path: entry.path, title: entry.title ?? entry.path, layer: fallbackLayer });
    }
  }

  refs.sort((a, b) => (a.layer === b.layer ? a.title.localeCompare(b.title) : a.layer.localeCompare(b.layer)));
  return refs;
}

/**
 * Union backlinks (body `[[wikilink]]`) and provenance-derived pages (K-page
 * frontmatter `sources:`) by path. Each entry gets a `sources` tag list — a
 * double-evidence reference is sorted above single-evidence ones. Within the
 * single-evidence tier, `sourced` (frontmatter declaration) sits above
 * `linked` (body wikilink) so the two evidence channels form contiguous
 * visual blocks; within an evidence sub-group, layer then title sort matches
 * resolveBacklinks for consistency.
 *
 * Pure-functional: never mutates inputs, never mutates entries already
 * placed in the result map. Title/layer of a shared path are taken from the
 * `linked` side; both sides are expected to agree because they are joined
 * against the same `pages.data` snapshot in the caller.
 */
export function mergeSourceReferences(linked: BacklinkRef[], sourced: BacklinkRef[]): SourceReference[] {
  const byPath = new Map<string, SourceReference>();

  for (const ref of linked) {
    byPath.set(ref.path, { ...ref, sources: ["linked"] });
  }
  for (const ref of sourced) {
    const existing = byPath.get(ref.path);
    if (existing) {
      // Already tagged on a prior iteration — leave it alone. Guards
      // against an upstream that hands us a sourced list with duplicate
      // paths (resolveDerivedPages dedupes today, but defensive merging
      // keeps the contract honest if a different caller skips that step).
      if (!existing.sources.includes("sourced")) {
        byPath.set(ref.path, { ...existing, sources: [...existing.sources, "sourced"] });
      }
    } else {
      byPath.set(ref.path, { ...ref, sources: ["sourced"] });
    }
  }

  function tierKey(sources: SourceTag[]): number {
    // Lower = higher in the panel. Double-evidence wins, then sourced-only,
    // then linked-only — sourced-only above linked-only keeps the two
    // single-evidence channels in contiguous blocks.
    if (sources.length === 2) return 0;
    if (sources[0] === "sourced") return 1;
    return 2;
  }

  const merged = Array.from(byPath.values());
  merged.sort((a, b) => {
    const aTier = tierKey(a.sources);
    const bTier = tierKey(b.sources);
    if (aTier !== bTier) {
      return aTier - bTier;
    }
    if (a.layer !== b.layer) {
      return a.layer.localeCompare(b.layer);
    }
    return a.title.localeCompare(b.title);
  });
  return merged;
}
