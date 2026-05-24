import { describe, expect, it } from "vitest";
import {
  extractAssetRefs,
  isRemoteRef,
  posixJoinNormalize,
  resolveAssetRef,
  stripFrontmatter
} from "./md-asset-refs";

describe("extractAssetRefs", () => {
  it("matches standard markdown image with optional title", () => {
    const refs = extractAssetRefs(
      'before ![alt text](images/foo.png "the title") after'
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      originalPath: "images/foo.png",
      alt: "alt text",
      syntax: "markdown"
    });
  });

  it("matches obsidian wikilink embed with alias", () => {
    const refs = extractAssetRefs("before ![[diagram.png|the alias]] after");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      originalPath: "diagram.png",
      alt: "the alias",
      syntax: "wikilink"
    });
  });

  it("handles paths with spaces", () => {
    const refs = extractAssetRefs("![](My Diagram.png)");
    expect(refs[0].originalPath).toBe("My Diagram.png");
  });

  it("returns refs in source order across syntaxes", () => {
    const refs = extractAssetRefs("![[a.png]] ... ![b](b.png) ... ![[c.png]]");
    expect(refs.map((r) => r.originalPath)).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("ignores non-image markdown links", () => {
    const refs = extractAssetRefs("[link](page.md) and [[wikilink]]");
    expect(refs).toEqual([]);
  });
});

describe("isRemoteRef", () => {
  it("treats http/https/data as remote", () => {
    expect(isRemoteRef("http://x/y.png")).toBe(true);
    expect(isRemoteRef("HTTPS://x/y.png")).toBe(true);
    expect(isRemoteRef("data:image/png;base64,iVBOR...")).toBe(true);
  });

  it("treats relative paths and bare filenames as local", () => {
    expect(isRemoteRef("./a.png")).toBe(false);
    expect(isRemoteRef("a.png")).toBe(false);
    expect(isRemoteRef("subdir/a.png")).toBe(false);
  });

  it("treats file: as local (mirrors core)", () => {
    expect(isRemoteRef("file:///a/b.png")).toBe(false);
  });
});

describe("stripFrontmatter", () => {
  it("strips a closed front-matter block", () => {
    expect(stripFrontmatter("---\ntitle: x\n---\nbody here\n")).toBe(
      "body here\n"
    );
  });

  it("leaves text alone when the block is unterminated", () => {
    const raw = "---\ntitle: x\nbody never closes";
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it("leaves text without front-matter alone", () => {
    expect(stripFrontmatter("# heading\n")).toBe("# heading\n");
  });
});

describe("posixJoinNormalize", () => {
  it("joins relative segments and resolves ..", () => {
    expect(posixJoinNormalize("notes", "../images/a.png")).toBe("images/a.png");
  });

  it("flags paths that escape the project root with a leading .. segment", () => {
    expect(posixJoinNormalize("notes", "../../escape.png").startsWith("..")).toBe(
      true
    );
  });

  it("treats backslashes as separators (windows-y input)", () => {
    expect(posixJoinNormalize("notes", "img\\a.png")).toBe("notes/img/a.png");
  });
});

describe("resolveAssetRef", () => {
  const available = new Set([
    "notes/foo.md",
    "notes/img/diagram.png",
    "assets/logo.png",
    "diagram.png"
  ]);

  it("resolves sibling-of-md first", () => {
    expect(
      resolveAssetRef("img/diagram.png", { mdRelPath: "notes/foo.md", available })
    ).toBe("notes/img/diagram.png");
  });

  it("falls back to project-root when sibling miss", () => {
    expect(
      resolveAssetRef("assets/logo.png", {
        mdRelPath: "notes/foo.md",
        available
      })
    ).toBe("assets/logo.png");
  });

  it("returns null for missing refs", () => {
    expect(
      resolveAssetRef("img/missing.png", {
        mdRelPath: "notes/foo.md",
        available
      })
    ).toBeNull();
  });

  it("returns null for remote refs", () => {
    expect(
      resolveAssetRef("https://example.com/x.png", {
        mdRelPath: "notes/foo.md",
        available
      })
    ).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(
      resolveAssetRef("/absolute/a.png", {
        mdRelPath: "notes/foo.md",
        available
      })
    ).toBeNull();
  });
});
