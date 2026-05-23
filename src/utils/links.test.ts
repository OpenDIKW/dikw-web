import { describe, expect, it } from "vitest";
import type { DerivedPage, DocumentRecord, IncomingLink } from "../types";
import { mergeSourceReferences, resolveBacklinks, resolveDerivedPages } from "./links";

function doc(path: string, layer: DocumentRecord["layer"], title: string | null): DocumentRecord {
  return {
    doc_id: path,
    path,
    path_key: path,
    title,
    hash: "0".repeat(64),
    mtime: 0,
    layer,
    active: true
  };
}

function incoming(src_path: string): IncomingLink {
  return { src_doc_id: src_path, src_path, link_type: "wikilink", anchor: null, line: 1 };
}

const pages: DocumentRecord[] = [
  doc("wiki/a.md", "wiki", "Architecture"),
  doc("wisdom/b.md", "wisdom", "Lesson B"),
  doc("sources/x.md", "source", "Source X")
];

describe("resolveBacklinks", () => {
  it("joins incoming src_path against pages to recover title and layer", () => {
    const refs = resolveBacklinks([incoming("wiki/a.md"), incoming("wisdom/b.md")], pages);
    expect(refs).toEqual([
      { path: "wiki/a.md", title: "Architecture", layer: "wiki" },
      { path: "wisdom/b.md", title: "Lesson B", layer: "wisdom" }
    ]);
  });

  it("falls back to the basename when the linking page has no title", () => {
    const refs = resolveBacklinks([incoming("wiki/a.md")], [doc("wiki/a.md", "wiki", null)]);
    expect(refs).toEqual([{ path: "wiki/a.md", title: "a", layer: "wiki" }]);
  });

  it("skips incoming links whose src_path is missing or points to an inactive page", () => {
    expect(resolveBacklinks([incoming("wiki/ghost.md")], pages)).toEqual([]);
    const inactive: DocumentRecord[] = [{ ...doc("wiki/stale.md", "wiki", "Stale"), active: false }];
    expect(resolveBacklinks([incoming("wiki/stale.md")], inactive)).toEqual([]);
  });

  it("dedupes multiple incoming edges from the same source page", () => {
    const refs = resolveBacklinks([incoming("wiki/a.md"), incoming("wiki/a.md")], pages);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toBe("wiki/a.md");
  });

  it("optionally filters to the requested layers", () => {
    const refs = resolveBacklinks([incoming("wiki/a.md"), incoming("wisdom/b.md")], pages, {
      layers: ["wisdom"]
    });
    expect(refs).toEqual([{ path: "wisdom/b.md", title: "Lesson B", layer: "wisdom" }]);
  });
});

function derived(path: string, title: string | null = null): DerivedPage {
  return { doc_id: `wiki:${path}`, path, title };
}

describe("resolveDerivedPages", () => {
  it("joins derived path against pages to recover title and layer", () => {
    const refs = resolveDerivedPages([derived("wiki/a.md"), derived("wisdom/b.md")], pages);
    expect(refs).toEqual([
      { path: "wiki/a.md", title: "Architecture", layer: "wiki" },
      { path: "wisdom/b.md", title: "Lesson B", layer: "wisdom" }
    ]);
  });

  it("drops derived entries whose path points to an inactive page", () => {
    const inactive: DocumentRecord[] = [{ ...doc("wiki/stale.md", "wiki", "Stale"), active: false }];
    expect(resolveDerivedPages([derived("wiki/stale.md")], inactive)).toEqual([]);
  });

  it("dedupes when the same derived path appears twice", () => {
    const refs = resolveDerivedPages([derived("wiki/a.md"), derived("wiki/a.md")], pages);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toBe("wiki/a.md");
  });

  it("renders entries whose path is not in pages yet using the wire title", () => {
    // Newly synthesized K-page returned by /provenance hasn't propagated to
    // pages.data yet; fall back to the API-provided title instead of dropping.
    const refs = resolveDerivedPages([derived("wiki/fresh.md", "Fresh page")], pages);
    expect(refs).toEqual([{ path: "wiki/fresh.md", title: "Fresh page", layer: "wiki" }]);
  });

  it("falls back to path when both pages.data and wire title are missing", () => {
    const refs = resolveDerivedPages([derived("wiki/unknown.md", null)], pages);
    expect(refs).toEqual([{ path: "wiki/unknown.md", title: "wiki/unknown.md", layer: "wiki" }]);
  });

  it("still drops entries whose path matches an inactive page", () => {
    // Inactive doc takes precedence over the wire title — a tombstoned page
    // should not silently reappear in the panel.
    const inactive: DocumentRecord[] = [{ ...doc("wiki/stale.md", "wiki", "Stale"), active: false }];
    expect(resolveDerivedPages([derived("wiki/stale.md", "Stale wire title")], inactive)).toEqual([]);
  });

  it("infers wisdom layer from path for cache-lag entries", () => {
    // provenance edges only point at wiki / wisdom; a `wisdom/` prefix
    // signals wisdom layer when pages.data hasn't caught up. Hardcoding
    // "wiki" would mislabel the chip until the next pages reload.
    const refs = resolveDerivedPages(
      [derived("wisdom/insight.md", "Insight on architecture")],
      pages
    );
    expect(refs).toEqual([{ path: "wisdom/insight.md", title: "Insight on architecture", layer: "wisdom" }]);
  });
});

describe("mergeSourceReferences", () => {
  it("marks linked+sourced when a path appears in both lists", () => {
    const merged = mergeSourceReferences(
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }],
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ path: "wiki/a.md", title: "Architecture", layer: "wiki" });
    expect(new Set(merged[0]?.sources)).toEqual(new Set(["linked", "sourced"]));
  });

  it("sorts double-evidence above single-evidence, sourced-only above linked-only", () => {
    const merged = mergeSourceReferences(
      [
        { path: "wiki/a.md", title: "Architecture", layer: "wiki" },
        { path: "wiki/c.md", title: "Concepts", layer: "wiki" }
      ],
      [
        { path: "wiki/c.md", title: "Concepts", layer: "wiki" },
        { path: "wiki/d.md", title: "Design", layer: "wiki" }
      ]
    );
    // c is double-evidence (top); within single-evidence d is sourced-only
    // (above) and a is linked-only (below) — the two channels form
    // contiguous blocks instead of interleaving by title.
    expect(merged.map((ref) => ref.path)).toEqual(["wiki/c.md", "wiki/d.md", "wiki/a.md"]);
    expect(new Set(merged[0]?.sources)).toEqual(new Set(["linked", "sourced"]));
    expect(merged[1]?.sources).toEqual(["sourced"]);
    expect(merged[2]?.sources).toEqual(["linked"]);
  });

  it("preserves linked-only and sourced-only entries with the right tag", () => {
    const merged = mergeSourceReferences(
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }],
      [{ path: "wiki/b.md", title: "Lesson B", layer: "wisdom" }]
    );
    // sourced-only sorts above linked-only within the single-evidence tier.
    expect(merged).toEqual([
      { path: "wiki/b.md", title: "Lesson B", layer: "wisdom", sources: ["sourced"] },
      { path: "wiki/a.md", title: "Architecture", layer: "wiki", sources: ["linked"] }
    ]);
  });

  it("does not upgrade to double-evidence when sourced contains duplicate paths", () => {
    // Defensive against an upstream that hands us duplicate sourced
    // entries — the second pass over the same path must not flip a
    // sourced-only entry into a false `linked,sourced` double-evidence.
    const merged = mergeSourceReferences(
      [],
      [
        { path: "wiki/a.md", title: "Architecture", layer: "wiki" },
        { path: "wiki/a.md", title: "Architecture", layer: "wiki" }
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(["sourced"]);
  });

  it("does not mutate the inputs or share state across calls", () => {
    const linked = [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" as const }];
    const sourced = [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" as const }];
    const linkedSnapshot = JSON.parse(JSON.stringify(linked));
    const sourcedSnapshot = JSON.parse(JSON.stringify(sourced));
    mergeSourceReferences(linked, sourced);
    expect(linked).toEqual(linkedSnapshot);
    expect(sourced).toEqual(sourcedSnapshot);
  });
});
