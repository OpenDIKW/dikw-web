import type { DocumentRecord, IncomingLink, Layer } from "../types";
import { displayTitle } from "./format";

export interface BacklinkRef {
  path: string;
  title: string;
  layer: Layer;
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
    if (!doc) {
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
