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
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const result = injectInlineRefs("See the Architecture page.", refs);
    expect(result.body).toBe("See the [[Architecture|Architecture]] page.");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/architecture.md"]));
  });

  it("only replaces the first occurrence per ref, leaving later occurrences intact", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const result = injectInlineRefs("Architecture is the topic. Architecture matters.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is the topic. Architecture matters.");
  });

  it("scans multiple refs independently in a single pass", () => {
    const refs = [
      ref("knowledge/architecture.md", "Architecture"),
      ref("knowledge/synthesis.md", "Synthesis"),
    ];
    const result = injectInlineRefs("Architecture then Synthesis.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] then [[Synthesis|Synthesis]].");
    expect(result.matchedPaths).toEqual(
      new Set(["knowledge/architecture.md", "knowledge/synthesis.md"]),
    );
  });

  it("leaves matchedPaths empty for refs that never appear in the body", () => {
    const refs = [ref("knowledge/missing.md", "MissingTitle")];
    const result = injectInlineRefs("Body without any match.", refs);
    expect(result.body).toBe("Body without any match.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches case-insensitively and preserves the source-side literal in the button label", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const result = injectInlineRefs("the architecture of...", refs);
    expect(result.body).toBe("the [[Architecture|architecture]] of...");
  });

  it("preserves uppercase source literal when the title is mixed-case", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const result = injectInlineRefs("THE ARCHITECTURE OF...", refs);
    expect(result.body).toBe("THE [[Architecture|ARCHITECTURE]] OF...");
  });

  it("requires word boundaries for ASCII titles (does not match inside larger ASCII words)", () => {
    const refs = [ref("knowledge/rest.md", "REST")];
    const result = injectInlineRefs("a RESTful API and restful_api too", refs);
    expect(result.body).toBe("a RESTful API and restful_api too");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches CJK titles without word boundaries (CJK has no inter-word space)", () => {
    const refs = [ref("knowledge/arch.md", "架构")];
    const result = injectInlineRefs("系统架构包含三个核心组件。", refs);
    expect(result.body).toBe("系统[[架构|架构]]包含三个核心组件。");
  });

  it("skips ASCII titles shorter than 3 characters", () => {
    const refs = [ref("knowledge/a.md", "AI"), ref("knowledge/b.md", "x")];
    const result = injectInlineRefs("AI and x are both short.", refs);
    expect(result.body).toBe("AI and x are both short.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("skips CJK titles shorter than 2 characters", () => {
    const refs = [ref("knowledge/y.md", "是")];
    const result = injectInlineRefs("这是一段话。", refs);
    expect(result.body).toBe("这是一段话。");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches the longest title first when titles overlap by prefix", () => {
    // Refs in 'wrong' order on purpose — the longer title must win.
    const refs = [
      ref("knowledge/arch.md", "Arch"),
      ref("knowledge/architecture.md", "Architecture"),
    ];
    const result = injectInlineRefs("Architecture is everything.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is everything.");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/architecture.md"]));
  });

  it("does not re-scan a region that has already been wrapped by a prior ref", () => {
    // After 'Architecture' is wrapped, the inner 'Arch' substring must not be
    // independently re-matched by a later ref.
    const refs = [
      ref("knowledge/architecture.md", "Architecture"),
      ref("knowledge/arch.md", "Arch"),
    ];
    const result = injectInlineRefs("Architecture mentioned once.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] mentioned once.");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/architecture.md"]));
  });

  it("does not re-scan a wrapped CJK region (segment guard, not regex boundary)", () => {
    // ASCII word boundary would naturally block 'Arch' inside '[[Architecture|...]]'
    // because the next char is a letter; CJK has no boundary, so this case
    // actually exercises the segment.kind === 'protected' guard in injectOneRef.
    const refs = [ref("knowledge/x.md", "架构图"), ref("knowledge/y.md", "构图")];
    const result = injectInlineRefs("系统架构图原理。", refs);
    expect(result.body).toBe("系统[[架构图|架构图]]原理。");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/x.md"]));
  });

  it("never replaces inside YAML frontmatter", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const body = "---\ntitle: Architecture notes\n---\n\nBody mentions Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "---\ntitle: Architecture notes\n---\n\nBody mentions [[Architecture|Architecture]].",
    );
    expect(result.matchedPaths).toEqual(new Set(["knowledge/architecture.md"]));
  });

  it("never replaces inside fenced code blocks", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const body =
      "Plain Architecture.\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Plain [[Architecture|Architecture]].\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again.",
    );
  });

  it("never replaces inside mermaid fences (mermaid is a fenced code lang)", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "```mermaid\ngraph LR\n  A[Architecture] --> B\n```";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(body);
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("supports tilde-fenced code blocks", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "~~~\nArchitecture inside tildes\n~~~\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "~~~\nArchitecture inside tildes\n~~~\n\nAfter [[Architecture|Architecture]].",
    );
  });

  it("never replaces inside indented (4-space) code blocks", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body =
      "Before Architecture.\n\n    Architecture in indented code\n    more code\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n    Architecture in indented code\n    more code\n\nAfter Architecture.",
    );
    // Only the first plain occurrence (Before) is replaced.
    expect(result.matchedPaths).toEqual(new Set(["knowledge/arch.md"]));
  });

  it("never replaces inside inline code", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Use `Architecture.tsx` for the file. Architecture is the concept.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Use `Architecture.tsx` for the file. [[Architecture|Architecture]] is the concept.",
    );
  });

  it("never replaces inside display math ($$...$$)", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "$$\\text{Architecture} = f(x)$$\n\nThen Architecture is great.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "$$\\text{Architecture} = f(x)$$\n\nThen [[Architecture|Architecture]] is great.",
    );
  });

  it("never replaces inside inline math ($...$) within the same line", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Inline $Architecture_i$ and then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Inline $Architecture_i$ and then [[Architecture|Architecture]].");
  });

  it("escaped dollar (\\$) does not open a math span", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Cost is \\$5 for Architecture lessons.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Cost is \\$5 for [[Architecture|Architecture]] lessons.");
  });

  it("never replaces inside raw <details> blocks", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body =
      "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter [[Architecture|Architecture]].",
    );
  });

  it("never replaces inside raw <table> blocks", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "<table><tr><td>Architecture cell</td></tr></table>\n\nThen Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "<table><tr><td>Architecture cell</td></tr></table>\n\nThen [[Architecture|Architecture]].",
    );
  });

  it("never replaces inside existing wikilinks or obsidian image embeds", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "See [[Architecture]] and ![[notes/Architecture.png]] then Architecture is back.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "See [[Architecture]] and ![[notes/Architecture.png]] then [[Architecture|Architecture]] is back.",
    );
  });

  it("never replaces inside a markdown link [text](url) — neither text nor url", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body =
      "Read [the Architecture guide](https://example.com/Architecture). Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Read [the Architecture guide](https://example.com/Architecture). Then [[Architecture|Architecture]].",
    );
  });

  it("allows replacement inside heading text", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "# Architecture source\n\nBody.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("# [[Architecture|Architecture]] source\n\nBody.");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/arch.md"]));
  });

  it("does not mutate the input refs array or its entries", () => {
    const original: InlineRefMatch[] = [
      ref("knowledge/architecture.md", "Architecture"),
      ref("knowledge/synthesis.md", "Synthesis"),
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    injectInlineRefs("Architecture then Synthesis.", original);
    expect(original).toEqual(snapshot);
  });

  it("returns matchedPaths exactly equal to the set of refs that were injected", () => {
    const refs = [
      ref("knowledge/architecture.md", "Architecture"), // present
      ref("knowledge/synthesis.md", "Synthesis"), // present
      ref("knowledge/missing.md", "AbsolutelyMissing"), // absent
    ];
    const result = injectInlineRefs("Architecture then Synthesis only.", refs);
    expect(result.matchedPaths).toEqual(
      new Set(["knowledge/architecture.md", "knowledge/synthesis.md"]),
    );
  });

  it("counts each matched ref's path exactly once even when scanned in unusual order", () => {
    // Same ref appearing multiple times in input — only one injection happens,
    // matchedPaths has one entry.
    const refs = [
      ref("knowledge/arch.md", "Architecture"),
      ref("knowledge/arch.md", "Architecture"),
    ];
    const result = injectInlineRefs("Architecture, Architecture, Architecture.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]], Architecture, Architecture.");
    expect(result.matchedPaths).toEqual(new Set(["knowledge/arch.md"]));
  });
});

describe("injectInlineRefs — Codex review fix coverage", () => {
  // Finding 3: CRLF line endings on line-oriented recognizers.
  it("treats CRLF frontmatter as protected and normalizes to LF in output", () => {
    const refs = [ref("knowledge/architecture.md", "Architecture")];
    const body = "---\r\ntitle: Architecture notes\r\n---\r\n\r\nBody mentions Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "---\ntitle: Architecture notes\n---\n\nBody mentions [[Architecture|Architecture]].",
    );
    expect(result.matchedPaths).toEqual(new Set(["knowledge/architecture.md"]));
  });

  it("treats CRLF fenced code as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body =
      "Plain Architecture.\r\n\r\n```ts\r\nconst Architecture = 1;\r\n```\r\n\r\nLater Architecture again.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Plain [[Architecture|Architecture]].\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again.",
    );
  });

  it("treats CRLF indented code as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body =
      "Before Architecture.\r\n\r\n    Architecture in indented code\r\n    more code\r\n\r\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n    Architecture in indented code\n    more code\n\nAfter Architecture.",
    );
  });

  // Finding 2: fenced code 0-3 indent + ≥3 fence length.
  it("treats fenced code with 1-3 space indentation as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Before Architecture.\n\n   ```ts\n   const Architecture = 1;\n   ```\n\nLater.";
    const result = injectInlineRefs(body, refs);
    // First occurrence (Before) is replaced; the indented fence block is opaque.
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n   ```ts\n   const Architecture = 1;\n   ```\n\nLater.",
    );
  });

  it("treats fences with length ≥4 as protected (closer must be ≥ opener length)", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    // Opener is 4 backticks; inner uses 3 backticks (which would not close).
    // Closer is also 4 backticks.
    const body =
      "Before.\n\n````md\nExample with ```ts inside\nconst Architecture = 1;\n```\n````\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before.\n\n````md\nExample with ```ts inside\nconst Architecture = 1;\n```\n````\n\nAfter [[Architecture|Architecture]].",
    );
  });

  it("treats unclosed fence at EOF as protected through end of document", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Before Architecture.\n\n```ts\nconst Architecture = 1;\n// no closing fence";
    const result = injectInlineRefs(body, refs);
    // Only the leading "Before Architecture" gets replaced.
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n```ts\nconst Architecture = 1;\n// no closing fence",
    );
  });

  // Finding 4: markdown link variants.
  it("treats markdown link URLs with one level of balanced parens as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Read [docs](https://example.com/Architecture(v2)). Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Read [docs](https://example.com/Architecture(v2)). Then [[Architecture|Architecture]].",
    );
  });

  it("treats reference-style links [text][label] as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "See [Architecture overview][arch] for context. Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "See [Architecture overview][arch] for context. Then [[Architecture|Architecture]].",
    );
  });

  it("treats collapsed-reference links [text][] as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "See [Architecture][] later. Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("See [Architecture][] later. Then [[Architecture|Architecture]].");
  });

  it("treats link reference definitions [label]: url as protected", () => {
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Body Architecture matters.\n\n[arch]: https://example.com/Architecture";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Body [[Architecture|Architecture]] matters.\n\n[arch]: https://example.com/Architecture",
    );
  });

  it("treats link reference definitions WITHOUT whitespace after the colon as protected", () => {
    // markdown-it (and CommonMark in practice) accepts `[arch]:url` with no
    // space after the colon — round-2 review caught this gap in the original
    // `[ \t]+` form.
    const refs = [ref("knowledge/arch.md", "Architecture")];
    const body = "Body Architecture matters.\n\n[arch]:https://example.com/Architecture";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Body [[Architecture|Architecture]] matters.\n\n[arch]:https://example.com/Architecture",
    );
  });
});
