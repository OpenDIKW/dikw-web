import { describe, expect, it } from "vitest";
import { extractHeadingsWithSlugs, slugifyHeading } from "./markdown.js";

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
