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

  it("treats a standalone image (Obsidian / CommonMark) as special, not translated text", () => {
    // A figure on its own line must render ONCE, centered — not duplicated and
    // alt-translated in both columns of the bilingual view.
    const obsidian = splitMarkdownBlocks("Lead.\n\n![[figures/fig1.png]]\n\nFig.1 caption.");
    expect(obsidian.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(obsidian[1].md).toBe("![[figures/fig1.png]]");

    const commonmark = splitMarkdownBlocks("Lead.\n\n![Fig 1](./fig1.png)\n\nFig.1 caption.");
    expect(commonmark.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(commonmark[1].md).toBe("![Fig 1](./fig1.png)");
  });

  it("treats a linked image and an image with a title as image-only special blocks", () => {
    expect(kinds('![cover](a.png "Title")')).toEqual(["special"]);
    // `[![alt](img.png)](page)` — an image wrapped in a link, still no prose.
    expect(kinds("[![alt](img.png)](https://example.com)")).toEqual(["special"]);
  });

  it("keeps an image-only list item / blockquote line as text (does not break the list)", () => {
    // A bare-image bullet is still part of its list; pulling it out as a centered
    // figure would carve up the surrounding list/quote. Such lines stay text.
    expect(kinds("- ![](a.png)\n- text item")).toEqual(["text"]);
    expect(kinds("> ![[quote.png]]")).toEqual(["text"]);
  });

  it("keeps a paragraph that mixes prose and an image as a translatable text block", () => {
    // Inline image inside a sentence — the prose must still be translated, so the
    // whole paragraph stays one text block (we only pull out image-ONLY blocks).
    expect(kinds("See ![chart](c.png) for the trend over time.")).toEqual(["text"]);
  });

  it("pulls a standalone-image LINE out of a caption block joined by a hard line break", () => {
    // MinerU emits the caption and its figure on consecutive lines (a hard line
    // break with trailing spaces, NOT a blank line), so they land in one block.
    // The image line must still be split off as special — otherwise the figure
    // renders in both bilingual columns (the Fig. 2 regression on cho-cqa).
    const body =
      "Fig. 2 Comparison of (A) acidic and (B) basic variants $N=2$   \n" +
      "![[assets/images/abc.jpg]]\n\nNext paragraph.";
    const blocks = splitMarkdownBlocks(body);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "special", "text"]);
    expect(blocks[0].md).toBe("Fig. 2 Comparison of (A) acidic and (B) basic variants $N=2$");
    expect(blocks[1].md).toBe("![[assets/images/abc.jpg]]");
    expect(blocks[2].md).toBe("Next paragraph.");
  });

  it("separates interleaved image lines and <details> charts (real Fig. 2 shape)", () => {
    const body =
      "Caption one.\n![[assets/images/a.jpg]]\n\n<details>\n<summary>bar</summary>\n\n" +
      "| x | y |\n| - | - |\n| 1 | 2 |\n</details>\n\n![[assets/images/b.jpg]]";
    expect(kinds(body)).toEqual(["text", "special", "special", "special"]);
  });

  it("does not split an image line that lives inside a fenced code block", () => {
    // A code sample that shows image syntax must stay one code block, not get
    // carved up by the image-line detector.
    const body = "```md\nUse this:\n![[fig.png]]\nto embed.\n```";
    const blocks = splitMarkdownBlocks(body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("special");
    expect(blocks[0].md).toContain("![[fig.png]]");
  });

  it("returns [] for empty / whitespace-only input", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
    expect(splitMarkdownBlocks("   \n\n  \n")).toEqual([]);
  });
});
