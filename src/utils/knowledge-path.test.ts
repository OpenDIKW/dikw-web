import { describe, expect, it } from "vitest";
import { normalizeKnowledgePath } from "./knowledge-path";

describe("normalizeKnowledgePath", () => {
  it("rewrites a leading wiki/ segment to knowledge/", () => {
    expect(normalizeKnowledgePath("wiki/entities/zhan-na.md")).toBe("knowledge/entities/zhan-na.md");
  });

  it("leaves an already-knowledge path unchanged", () => {
    expect(normalizeKnowledgePath("knowledge/entities/y-musk.md")).toBe("knowledge/entities/y-musk.md");
  });

  it("leaves source paths unchanged", () => {
    expect(normalizeKnowledgePath("sources/elon-musk.md")).toBe("sources/elon-musk.md");
  });

  it("only rewrites the wiki/ prefix, not a wiki/ in the middle", () => {
    expect(normalizeKnowledgePath("sources/wiki/note.md")).toBe("sources/wiki/note.md");
  });

  it("does not touch lookalike prefixes such as wikipedia/", () => {
    expect(normalizeKnowledgePath("wikipedia/Elon_Musk")).toBe("wikipedia/Elon_Musk");
  });

  it("passes through web URLs verbatim", () => {
    expect(normalizeKnowledgePath("https://example.com/wiki/x")).toBe("https://example.com/wiki/x");
  });

  it("handles the empty string", () => {
    expect(normalizeKnowledgePath("")).toBe("");
  });
});
