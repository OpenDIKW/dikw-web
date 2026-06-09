import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdown-blocks";

const kinds = (md: string) => splitMarkdownBlocks(md).map((b) => b.kind);

describe("splitMarkdownBlocks", () => {
  it("splits paragraphs on blank lines into text blocks", () => {
    const blocks = splitMarkdownBlocks("First paragraph.\n\nSecond paragraph.");
    expect(blocks).toEqual([
      { kind: "text", md: "First paragraph." },
      { kind: "text", md: "Second paragraph." },
    ]);
  });

  it("keeps a heading and a multi-line list each as a single text block", () => {
    const blocks = splitMarkdownBlocks("# Title\n\n- one\n- two\n- three");
    expect(blocks).toEqual([
      { kind: "text", md: "# Title" },
      { kind: "text", md: "- one\n- two\n- three" },
    ]);
  });

  it("does not split inside a fenced code block (blank lines and # survive)", () => {
    const body =
      "Intro.\n\n```py\ndef f():\n\n    # comment, not a heading\n    return 1\n```\n\nOutro.";
    const blocks = splitMarkdownBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(blocks[0].md).toBe("Intro.");
    expect(blocks[1].md).toContain("def f():");
    expect(blocks[1].md).toContain("# comment, not a heading");
    expect(blocks[2].md).toBe("Outro.");
  });

  it("treats a mermaid fence as a single special block", () => {
    const blocks = splitMarkdownBlocks("```mermaid\ngraph TD;\nA-->B;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("special");
    expect(blocks[0].md).toContain("graph TD;");
  });

  it("treats a pipe table as one special block, with surrounding text as text", () => {
    const body = "Before.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter.";
    const blocks = splitMarkdownBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(blocks[1].md).toContain("| A | B |");
    expect(blocks[1].md).toContain("| 3 | 4 |");
  });

  it("treats $$ display math as a special block", () => {
    const blocks = splitMarkdownBlocks("Lead.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nTail.");
    expect(blocks.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(blocks[1].md).toContain("\\int_0^1");
  });

  it("treats a <details> chart block as special", () => {
    const body =
      "Chart:\n\n<details><summary>bar</summary>\n\n| x | y |\n| --- | --- |\n| a | 1 |\n\n</details>\n\nDone.";
    const blocks = splitMarkdownBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(blocks[1].md.startsWith("<details")).toBe(true);
  });

  it("treats a raw <table> as special", () => {
    const body = "Here:\n\n<table><tr><td>a</td></tr></table>\n\nEnd.";
    expect(kinds(body)).toEqual(["text", "special", "text"]);
  });

  it("treats a standalone thematic break as special but a setext underline as text", () => {
    expect(kinds("Para one.\n\n---\n\nPara two.")).toEqual(["text", "special", "text"]);
    // `---` directly under text is a setext H2 underline → stays a single text block.
    const setext = splitMarkdownBlocks("Section Title\n---\n\nBody.");
    expect(setext.map((b) => b.kind)).toEqual(["text", "text"]);
    expect(setext[0].md).toBe("Section Title\n---");
  });

  it("orders interleaved text and special blocks correctly", () => {
    const body = "# H\n\nPara.\n\n```js\nx;\n```\n\nMid.\n\n| a |\n| - |\n| 1 |\n\nEnd.";
    expect(kinds(body)).toEqual(["text", "text", "special", "text", "special", "text"]);
  });

  it("returns [] for empty / whitespace-only input", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
    expect(splitMarkdownBlocks("   \n\n  \n")).toEqual([]);
  });
});
