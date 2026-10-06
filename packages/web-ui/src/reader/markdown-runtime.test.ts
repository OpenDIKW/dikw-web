import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import fixture from "../../../../tests/fixtures/scientific-markdown.json";
import { renderMarkdown, renderMarkdownBlockHtml } from "./markdown-runtime.js";

const ctx = { assets: [], assetBaseUrl: "", assetToken: "" };

function read(body: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(body, ctx);
  return root;
}

describe("scientific inline markup", () => {
  it("renders the shared MinerU fixture without losing table or heading text", () => {
    const root = read(fixture.body);
    expect(root.querySelector("h2")?.id).toBe(fixture.slug);
    expect(root.querySelector("h2")?.textContent).toBe(fixture.heading);
    expect(Array.from(root.querySelectorAll("td"), (cell) => cell.textContent)).toEqual(
      fixture.cells,
    );
  });

  it.each([
    ["Accuracy improved markedly<sup>18,19</sup>.", "sup", "18,19"],
    ["References<sup>1–4</sup>", "sup", "1–4"],
    ["Results<sup>*</sup> and notes<sup>†</sup>", "sup", "*"],
    ["10<sup>-3</sup> s<sup>-1</sup> m<sup>2</sup>", "sup", "-3"],
    ["CO<sub>2</sub> and H<sub>2</sub>O", "sub", "2"],
    ["*Value<sup>1</sup>*", "em sup", "1"],
    ["[Value<sup>1</sup>](https://example.org)", "a sup", "1"],
    ["- Value<sup>1</sup>", "li sup", "1"],
    ["> Value<sup>1</sup>", "blockquote sup", "1"],
    ["## Results<sup>*</sup>", "h2 sup", "*"],
    ["Value<SUP>4</SUP> and <SuB>2</sUb>", "sup", "4"],
    ["Value<sup>**bold** &amp; [ref](https://example.org)</sup>", "sup strong", "bold"],
    ["| Value |\n| --- |\n| 10<sup>-3</sup> |", "td sup", "-3"],
  ])("renders %s", (body, selector, text) => {
    const root = read(body);
    expect(root.querySelector(selector)?.textContent).toBe(text);
    expect(root.textContent).not.toMatch(/<\/?(?:sup|sub)>/i);
  });

  it.each([
    '<sup onclick="alert(1)">1</sup>',
    '<sup style="font-size:40px">1</sup>',
    '<sup class="x">1</sup>',
    "<sup><script>window.x=1</script>2</sup>",
    "<sup><img src=x onerror=alert(1)>2</sup>",
    "<sup><sub>2</sub></sup>",
    "<sup><sup>2</sup><sup>3</sup></sup>",
    "Value<sup>3",
    "Value<sup>3 and <SUP>4</SUP>.",
    "<sup><sub>2</sub>",
    "Value<sup>3</sub>",
    "Value<sup >3</sup>",
    "Value<sup>3\n4</sup>",
  ])("keeps unsupported raw markup inert: %s", (body) => {
    const root = read(body);
    expect(root.querySelector("sup, sub, script, img, [onclick], [style], [class]")).toBeNull();
    expect(root.innerHTML).toBe(
      new MarkdownIt({ html: false, linkify: true, typographer: true }).render(body),
    );
  });

  it("keeps unsafe Markdown links inert inside superscripts", () => {
    const root = read("<sup>[bad](javascript:alert(1))</sup>");
    expect(root.querySelector("sup")?.textContent).toBe("[bad](javascript:alert(1))");
    expect(root.querySelector("a")).toBeNull();
  });

  it("keeps nested Markdown links out of link labels", () => {
    const root = read("[Value<sup>[inner](https://x.org)</sup>](https://y.org)");
    expect(root.querySelector("a a")).toBeNull();
    expect(root.querySelectorAll("a")).toHaveLength(2);
    expect(root.querySelector("sup a")?.getAttribute("href")).toBe("https://x.org");
    expect(
      renderMarkdown("[Value<sup>[inner](https://x.org)</sup>](https://y.org)", ctx),
    ).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("preserves a large run of unclosed tags as inert text", () => {
    const body = "<sup>".repeat(4000);
    const root = read(body);
    expect(root.querySelector("sup")).toBeNull();
    expect(root.textContent?.trim()).toBe(body);
  });

  it("retains scientific text in image alternatives and normal typography", () => {
    const root = read(
      '![CO<sub>2</sub>](https://example.org/figure.png)\n\n<sup>"quoted" (c) [ref](https://example.org)</sup>',
    );
    expect(root.querySelector("img")?.getAttribute("alt")).toBe("CO2");
    expect(root.querySelector("sup")?.textContent).toBe("“quoted” © ref");
    expect(root.querySelector("sup a")?.getAttribute("href")).toBe("https://example.org");
  });

  it.each(["<sup>[[name</sup> x]]", "<sup>$x</sup>$", "<sup>![[figure</sup> x]]"])(
    "bounds inner custom rules to the scientific content: %s",
    (body) => {
      const root = read(body);
      expect(root.querySelector("button, .katex, img, .md-broken-image")).toBeNull();
      expect(root.querySelector("sup")?.textContent).toBe(body.slice(5, body.indexOf("</sup>")));
      expect(root.textContent?.trim()).toBe(body.replace(/<\/?sup>/g, ""));
      expect(renderMarkdownBlockHtml(body, ctx, {})).toBe(renderMarkdown(body, ctx));
    },
  );

  it("preserves literal tags in code spans and fenced code", () => {
    const root = read(
      "Use `<sup>1</sup>` and `<sub>2</sub>`.\n\n```html\n<sup>1</sup>\n<sub>2</sub>\n```",
    );
    expect(Array.from(root.querySelectorAll("code"), (code) => code.textContent)).toEqual([
      "<sup>1</sup>",
      "<sub>2</sub>",
      "<sup>1</sup>\n<sub>2</sub>\n",
    ]);
    expect(root.querySelector("sup, sub")).toBeNull();
    expect(read("`<sup>` Value<sup>2</sup>").querySelector("sup")?.textContent).toBe("2");
  });

  it("shares heading ids between whole-document and bilingual block rendering", () => {
    const blocks = ["## Results<sup>*</sup>", "## Results<sup>†</sup>"];
    const env = {};
    const root = read(blocks.join("\n\n"));
    const blockRoot = document.createElement("div");
    blockRoot.innerHTML = blocks.map((block) => renderMarkdownBlockHtml(block, ctx, env)).join("");
    expect(Array.from(root.querySelectorAll("h2"), (heading) => heading.id)).toEqual([
      "results",
      "results-2",
    ]);
    expect(blockRoot.innerHTML).toBe(root.innerHTML);
  });

  it("preserves scientific table text and unwraps unsupported elements safely", () => {
    const root = read(
      '<table onclick="bad()"><tr><td>10<sup onclick="bad()" colspan="2">-3</sup></td><td><i style="color:red">E. coli</i></td><td>H<sub>2</sub>O</td><td><b>Bold</b><em>Em</em><strong>Strong</strong></td><td><span style="color:red"><font>kept</font><sup>2</sup></span><script>window.x=1</script><img src=x onerror="bad()"></td></tr></table>',
    );
    expect(Array.from(root.querySelectorAll("td"), (cell) => cell.textContent)).toEqual([
      "10-3",
      "E. coli",
      "H2O",
      "BoldEmStrong",
      "kept2window.x=1",
    ]);
    expect(root.querySelectorAll("sup")).toHaveLength(2);
    expect(root.querySelector("i")?.textContent).toBe("E. coli");
    expect(root.querySelector("sub")?.textContent).toBe("2");
    expect(
      root.querySelector("span, font, script, img, [onclick], [style], sup[colspan]"),
    ).toBeNull();
  });
});

describe("untrusted details rendering", () => {
  it("keeps repeated unclosed summary endings inert", () => {
    const body = "<details><summary>" + "</summary>a".repeat(5000);
    const root = read(body);
    expect(root.querySelector("details, summary")).toBeNull();
    expect(root.textContent?.trim()).toBe(body);
  });

  it("shares safe details and chart extraction with the outline and bilingual blocks", () => {
    const body =
      "<DETAILS OPEN><SUMMARY>Aside</SUMMARY>\n\n## Inside\n\n</DETAILS>\n\n<details><summary>bar</summary>\n| X | Y |\n| - | - |\n| A | 1 |\n</details>";
    const root = read(body);
    expect(root.querySelector("details")?.open).toBe(true);
    expect(root.querySelector("summary")?.textContent).toBe("Aside");
    expect(root.querySelector("h2")?.id).toBe("inside");
    expect(root.querySelector(".markdown-chart")?.getAttribute("data-chart-type")).toBe("bar");
    expect(renderMarkdownBlockHtml(body, ctx, {})).toBe(renderMarkdown(body, ctx));
  });
});
