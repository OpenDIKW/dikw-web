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

  it("drops derived entries whose path points to an unknown or inactive page", () => {
    expect(resolveDerivedPages([derived("wiki/ghost.md")], pages)).toEqual([]);
    const inactive: DocumentRecord[] = [{ ...doc("wiki/stale.md", "wiki", "Stale"), active: false }];
    expect(resolveDerivedPages([derived("wiki/stale.md")], inactive)).toEqual([]);
  });

  it("dedupes when the same derived path appears twice", () => {
    const refs = resolveDerivedPages([derived("wiki/a.md"), derived("wiki/a.md")], pages);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toBe("wiki/a.md");
  });
});

describe("mergeSourceReferences", () => {
  it("marks linked+sourced when a path appears in both lists", () => {
    const merged = mergeSourceReferences(
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }],
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }]
    );
    expect(merged).toEqual([
      { path: "wiki/a.md", title: "Architecture", layer: "wiki", sources: ["linked", "sourced"] }
    ]);
  });

  it("sorts double-evidence references above single-evidence", () => {
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
    expect(merged.map((ref) => ref.path)).toEqual(["wiki/c.md", "wiki/a.md", "wiki/d.md"]);
    expect(merged[0]?.sources).toEqual(["linked", "sourced"]);
  });

  it("preserves linked-only and sourced-only entries with the right tag", () => {
    const merged = mergeSourceReferences(
      [{ path: "wiki/a.md", title: "Architecture", layer: "wiki" }],
      [{ path: "wiki/b.md", title: "Lesson B", layer: "wisdom" }]
    );
    expect(merged).toEqual([
      { path: "wiki/a.md", title: "Architecture", layer: "wiki", sources: ["linked"] },
      { path: "wiki/b.md", title: "Lesson B", layer: "wisdom", sources: ["sourced"] }
    ]);
  });
});
