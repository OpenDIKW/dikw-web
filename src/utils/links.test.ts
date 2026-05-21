import { describe, expect, it } from "vitest";
import type { DocumentRecord, IncomingLink } from "../types";
import { resolveBacklinks } from "./links";

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

  it("skips incoming links whose src_path is not an active page", () => {
    const refs = resolveBacklinks([incoming("wiki/ghost.md")], pages);
    expect(refs).toEqual([]);
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
