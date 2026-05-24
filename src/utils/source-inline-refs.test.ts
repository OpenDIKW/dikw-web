import { describe, expect, it } from "vitest";
import { injectInlineRefs, type InlineRefMatch } from "./source-inline-refs";

const ref = (path: string, title: string): InlineRefMatch => ({ path, title });

describe("injectInlineRefs", () => {
  it("returns the body unchanged and an empty matched set when no refs are given", () => {
    const result = injectInlineRefs("# Hello\n\nBody text.", []);
    expect(result.body).toBe("# Hello\n\nBody text.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("replaces the first literal occurrence of a title with a wikilink marker", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("See the Architecture page.", refs);
    expect(result.body).toBe("See the [[Architecture|Architecture]] page.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("only replaces the first occurrence per ref, leaving later occurrences intact", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("Architecture is the topic. Architecture matters.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is the topic. Architecture matters.");
  });

  it("scans multiple refs independently in a single pass", () => {
    const refs = [ref("wiki/architecture.md", "Architecture"), ref("wiki/synthesis.md", "Synthesis")];
    const result = injectInlineRefs("Architecture then Synthesis.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] then [[Synthesis|Synthesis]].");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md", "wiki/synthesis.md"]));
  });

  it("leaves matchedPaths empty for refs that never appear in the body", () => {
    const refs = [ref("wiki/missing.md", "MissingTitle")];
    const result = injectInlineRefs("Body without any match.", refs);
    expect(result.body).toBe("Body without any match.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches case-insensitively and preserves the source-side literal in the button label", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("the architecture of...", refs);
    expect(result.body).toBe("the [[Architecture|architecture]] of...");
  });

  it("preserves uppercase source literal when the title is mixed-case", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("THE ARCHITECTURE OF...", refs);
    expect(result.body).toBe("THE [[Architecture|ARCHITECTURE]] OF...");
  });

  it("requires word boundaries for ASCII titles (does not match inside larger ASCII words)", () => {
    const refs = [ref("wiki/rest.md", "REST")];
    const result = injectInlineRefs("a RESTful API and restful_api too", refs);
    expect(result.body).toBe("a RESTful API and restful_api too");
    expect(result.matchedPaths).toEqual(new Set());
  });
});
