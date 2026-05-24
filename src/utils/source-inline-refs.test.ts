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

  it("matches CJK titles without word boundaries (CJK has no inter-word space)", () => {
    const refs = [ref("wiki/arch.md", "架构")];
    const result = injectInlineRefs("系统架构包含三个核心组件。", refs);
    expect(result.body).toBe("系统[[架构|架构]]包含三个核心组件。");
  });

  it("skips ASCII titles shorter than 3 characters", () => {
    const refs = [ref("wiki/a.md", "AI"), ref("wiki/b.md", "x")];
    const result = injectInlineRefs("AI and x are both short.", refs);
    expect(result.body).toBe("AI and x are both short.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("skips CJK titles shorter than 2 characters", () => {
    const refs = [ref("wiki/y.md", "是")];
    const result = injectInlineRefs("这是一段话。", refs);
    expect(result.body).toBe("这是一段话。");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches the longest title first when titles overlap by prefix", () => {
    // Refs in 'wrong' order on purpose — the longer title must win.
    const refs = [ref("wiki/arch.md", "Arch"), ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("Architecture is everything.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is everything.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("does not re-scan a region that has already been wrapped by a prior ref", () => {
    // After 'Architecture' is wrapped, the inner 'Arch' substring must not be
    // independently re-matched by a later ref.
    const refs = [ref("wiki/architecture.md", "Architecture"), ref("wiki/arch.md", "Arch")];
    const result = injectInlineRefs("Architecture mentioned once.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] mentioned once.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("does not re-scan a wrapped CJK region (segment guard, not regex boundary)", () => {
    // ASCII word boundary would naturally block 'Arch' inside '[[Architecture|...]]'
    // because the next char is a letter; CJK has no boundary, so this case
    // actually exercises the segment.kind === 'protected' guard in injectOneRef.
    const refs = [ref("wiki/x.md", "架构图"), ref("wiki/y.md", "构图")];
    const result = injectInlineRefs("系统架构图原理。", refs);
    expect(result.body).toBe("系统[[架构图|架构图]]原理。");
    expect(result.matchedPaths).toEqual(new Set(["wiki/x.md"]));
  });

  it("never replaces inside YAML frontmatter", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const body = "---\ntitle: Architecture notes\n---\n\nBody mentions Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "---\ntitle: Architecture notes\n---\n\nBody mentions [[Architecture|Architecture]]."
    );
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("never replaces inside fenced code blocks", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const body = "Plain Architecture.\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Plain [[Architecture|Architecture]].\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again."
    );
  });

  it("never replaces inside mermaid fences (mermaid is a fenced code lang)", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "```mermaid\ngraph LR\n  A[Architecture] --> B\n```";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(body);
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("supports tilde-fenced code blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "~~~\nArchitecture inside tildes\n~~~\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "~~~\nArchitecture inside tildes\n~~~\n\nAfter [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside indented (4-space) code blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Before Architecture.\n\n    Architecture in indented code\n    more code\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n    Architecture in indented code\n    more code\n\nAfter Architecture."
    );
    // Only the first plain occurrence (Before) is replaced.
    expect(result.matchedPaths).toEqual(new Set(["wiki/arch.md"]));
  });

  it("never replaces inside inline code", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Use `Architecture.tsx` for the file. Architecture is the concept.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Use `Architecture.tsx` for the file. [[Architecture|Architecture]] is the concept.");
  });

  it("never replaces inside display math ($$...$$)", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "$$\\text{Architecture} = f(x)$$\n\nThen Architecture is great.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "$$\\text{Architecture} = f(x)$$\n\nThen [[Architecture|Architecture]] is great."
    );
  });

  it("never replaces inside inline math ($...$) within the same line", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Inline $Architecture_i$ and then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Inline $Architecture_i$ and then [[Architecture|Architecture]].");
  });

  it("escaped dollar (\\$) does not open a math span", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Cost is \\$5 for Architecture lessons.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Cost is \\$5 for [[Architecture|Architecture]] lessons.");
  });

  it("never replaces inside raw <details> blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside raw <table> blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "<table><tr><td>Architecture cell</td></tr></table>\n\nThen Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "<table><tr><td>Architecture cell</td></tr></table>\n\nThen [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside existing wikilinks or obsidian image embeds", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "See [[Architecture]] and ![[notes/Architecture.png]] then Architecture is back.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "See [[Architecture]] and ![[notes/Architecture.png]] then [[Architecture|Architecture]] is back."
    );
  });

  it("never replaces inside a markdown link [text](url) — neither text nor url", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Read [the Architecture guide](https://example.com/Architecture). Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Read [the Architecture guide](https://example.com/Architecture). Then [[Architecture|Architecture]]."
    );
  });

  it("allows replacement inside heading text", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "# Architecture source\n\nBody.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("# [[Architecture|Architecture]] source\n\nBody.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/arch.md"]));
  });
});
