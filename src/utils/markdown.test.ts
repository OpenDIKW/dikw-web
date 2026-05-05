import { describe, expect, it } from "vitest";
import { getMarkdownTitle, parseMarkdownDocument } from "./markdown";

describe("parseMarkdownDocument", () => {
  it("removes YAML frontmatter and parses common metadata", () => {
    const parsed = parseMarkdownDocument(
      "---\ntitle: Architecture\ntags:\n- DIKW\n- modules\nsources:\n- sources/a.md\n---\n\n# Architecture\n\nBody"
    );

    expect(parsed.meta.title).toBe("Architecture");
    expect(parsed.meta.tags).toEqual(["DIKW", "modules"]);
    expect(parsed.meta.sources).toEqual(["sources/a.md"]);
    expect(parsed.body).toBe("Body");
  });

  it("falls back to the first heading as title", () => {
    expect(getMarkdownTitle("# Page\n\nBody")).toBe("Page");
  });
});
