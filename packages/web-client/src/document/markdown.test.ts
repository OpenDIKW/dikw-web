import { describe, expect, it } from "vitest";
import { extractHeadingsWithSlugs, rawDetailsPattern, slugifyHeading } from "./markdown.js";

describe("Markdown delimiter compatibility", () => {
  it.each([
    ["[[Target|Visible]] suffix", "visible-suffix"],
    ["[[Target]] suffix", "target-suffix"],
    ["[[Target|Alias|extra]]", "aliasextra"],
    ["[[|Alias]]", "alias"],
    ["[[Target|]]", "target"],
    ["[[broken] [[Good|Visible]]", "broken-visible"],
  ])("retains heading text for %s", (heading, slug) => {
    expect(slugifyHeading(heading)).toBe(slug);
  });

  it("retains details captures and offsets in replace, matchAll and exec", () => {
    const block = "<DETAILS open> \n<SUMMARY>İ Aside\nmore</SUMMARY>\n## Inner\n</DETAILS>";
    const body = `İ before ${block} after ${block}`;
    expect(rawDetailsPattern).toBeInstanceOf(RegExp);
    const matches = Array.from(body.matchAll(rawDetailsPattern));
    expect(matches.map((match) => [...match])).toEqual([
      [block, " open", "İ Aside\nmore", "\n## Inner\n"],
      [block, " open", "İ Aside\nmore", "\n## Inner\n"],
    ]);
    expect(matches.map((match) => match.index)).toEqual([
      body.indexOf(block),
      body.lastIndexOf(block),
    ]);
    expect(body.replace(rawDetailsPattern, (_raw, _attrs, summary) => `[${summary}]`)).toBe(
      "İ before [İ Aside\nmore] after [İ Aside\nmore]",
    );
    rawDetailsPattern.lastIndex = 0;
    expect(rawDetailsPattern.exec(body)?.index).toBe(body.indexOf(block));
    expect(rawDetailsPattern.exec(body)?.index).toBe(body.lastIndexOf(block));
    expect(rawDetailsPattern.exec(body)).toBeNull();
    expect(rawDetailsPattern.lastIndex).toBe(0);
  });

  it("keeps incomplete details literal while finding later complete blocks", () => {
    const valid = "<details><summary>Good</summary>body</details>";
    const body = `<details>broken\n${valid} <details><summary>unfinished</summary>`;
    expect(body.replace(rawDetailsPattern, "SAFE")).toBe(
      "<details>broken\nSAFE <details><summary>unfinished</summary>",
    );
  });

  it("honors lastIndex rewinds and returns fresh details match arrays", () => {
    const block = "<details><summary>Aside</summary>body</details>";
    const body = `a${block}${block}`;
    rawDetailsPattern.lastIndex = 0;
    const first = rawDetailsPattern.exec(body)!;
    expect(rawDetailsPattern.exec(body)?.index).toBe(block.length + 1);
    rawDetailsPattern.lastIndex = 1;
    expect(rawDetailsPattern.exec(body)?.index).toBe(1);
    first[0] = "changed";
    expect(body.replace(rawDetailsPattern, "SAFE")).toBe("aSAFESAFE");
    rawDetailsPattern.lastIndex = 1;
    expect(rawDetailsPattern.exec(body)?.index).toBe(1);
    const separated = `a${block}b${block}c`;
    expect(separated.split(rawDetailsPattern)).toEqual([
      "a",
      "",
      "Aside",
      "body",
      "b",
      "",
      "Aside",
      "body",
      "c",
    ]);
    expect(separated.match(rawDetailsPattern)).toEqual([block, block]);
    expect(separated.search(rawDetailsPattern)).toBe(1);
  });

  it("can start matching at a nested details opener", () => {
    const inner = "<details><summary>Inner</summary>body</details>";
    const body = `<details><summary>Outer</summary>${inner}</details>`;
    const start = body.indexOf(inner);
    rawDetailsPattern.lastIndex = start;
    expect(rawDetailsPattern.exec(body)?.[0]).toBe(inner);
    rawDetailsPattern.lastIndex = start;
    expect(Array.from(body.matchAll(rawDetailsPattern), (match) => match[0])).toEqual([inner]);
    rawDetailsPattern.lastIndex = 0;
  });
});

describe("scientific headings", () => {
  it("uses visible superscript and subscript text for outlines and slugs", () => {
    expect(
      extractHeadingsWithSlugs(
        "## Results<sup>*</sup>\n\n## Results<SUP>†</SUP>\n\n## CO<sub>2</sub>",
      ),
    ).toEqual([
      { level: 2, title: "Results*", slug: "results" },
      { level: 2, title: "Results†", slug: "results-2" },
      { level: 2, title: "CO2", slug: "co2" },
    ]);
    expect(slugifyHeading("Results<sup>*</sup>")).toBe("results");
  });

  it("preserves unsupported tag and code text in headings", () => {
    expect(
      extractHeadingsWithSlugs('## Value<sup class="x">1</sup>\n\n## Code `<sup>2</sup>`').map(
        (heading) => heading.title,
      ),
    ).toEqual(['Value<sup class="x">1</sup>', "Code `<sup>2</sup>`"]);
  });
});
