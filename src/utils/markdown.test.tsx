import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  extractHeadingsWithSlugs,
  getMarkdownTitle,
  parseMarkdownDocument,
  slugifyHeading,
  uniqueHeadingSlug,
} from "./markdown";
import { MarkdownView } from "../components/MarkdownView";

describe("parseMarkdownDocument", () => {
  it("removes YAML frontmatter and parses common metadata", () => {
    const parsed = parseMarkdownDocument(
      "---\ntitle: Architecture\ntags:\n- DIKW\n- modules\nsources:\n- sources/a.md\n---\n\n# Architecture\n\nBody",
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

describe("slugifyHeading", () => {
  it("lowercases, strips diacritics, replaces whitespace with dashes", () => {
    expect(slugifyHeading("Hello World")).toBe("hello-world");
    expect(slugifyHeading("Café")).toBe("cafe");
    expect(slugifyHeading("  Trim — Me  ")).toBe("trim-me");
  });

  it("returns an empty string for input without alphanumeric content", () => {
    expect(slugifyHeading("---")).toBe("");
    expect(slugifyHeading("***")).toBe("");
  });

  // Regression: source-page outline navigation broke when injectInlineRefs
  // wrapped a K-page title inside a heading, because MarkdownView's
  // heading_open saw the enhanced body (`[[Architecture|Architecture]] source`)
  // and extractHeadingsWithSlugs saw the original (`Architecture source`),
  // producing different slugs. Wikilink syntax must be stripped first so both
  // sides agree on `architecture-source`.
  it("strips Obsidian wikilink markup before slugifying", () => {
    expect(slugifyHeading("[[Architecture]] source")).toBe("architecture-source");
    expect(slugifyHeading("[[Architecture|Architecture]] source")).toBe("architecture-source");
    expect(slugifyHeading("[[Foo|Bar]] notes")).toBe("bar-notes");
  });

  it("produces identical slugs for the original heading and its inline-injected form", () => {
    // Asserts the invariant that the two code paths (heading_open vs
    // extractHeadingsWithSlugs) cannot diverge after injectInlineRefs runs.
    expect(slugifyHeading("Architecture source")).toBe(
      slugifyHeading("[[Architecture|Architecture]] source"),
    );
  });
});

describe("uniqueHeadingSlug", () => {
  it("appends an incrementing suffix on duplicate slugs within the same env", () => {
    const env: Record<string, unknown> = {};
    expect(uniqueHeadingSlug(env, "Introduction")).toBe("introduction");
    expect(uniqueHeadingSlug(env, "Introduction")).toBe("introduction-2");
    expect(uniqueHeadingSlug(env, "Introduction")).toBe("introduction-3");
  });

  it("uses fresh counters for independent envs", () => {
    const envA: Record<string, unknown> = {};
    const envB: Record<string, unknown> = {};
    expect(uniqueHeadingSlug(envA, "Section")).toBe("section");
    expect(uniqueHeadingSlug(envB, "Section")).toBe("section");
  });
});

describe("extractHeadingsWithSlugs", () => {
  it("returns level, title, and slug for each heading in order", () => {
    const body = "# Top\n\n## Sub\n\n### Deep\n";
    expect(extractHeadingsWithSlugs(body)).toEqual([
      { level: 1, title: "Top", slug: "top" },
      { level: 2, title: "Sub", slug: "sub" },
      { level: 3, title: "Deep", slug: "deep" },
    ]);
  });

  it("disambiguates same-title headings with numeric suffixes matching MarkdownView's DOM ids", () => {
    const body = "# Introduction\n\nfirst body\n\n## Other\n\n# Introduction\n\nsecond body\n";
    const headings = extractHeadingsWithSlugs(body);
    expect(headings.map((h) => h.slug)).toEqual(["introduction", "other", "introduction-2"]);

    const { container } = render(<MarkdownView body={body} />);
    const ids = Array.from(
      container.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
    ).map((el) => (el as HTMLElement).id);
    expect(ids).toEqual(headings.map((h) => h.slug));
    for (const heading of headings) {
      expect(container.querySelector(`#${heading.slug}`)).not.toBeNull();
    }
  });

  it("ignores `#`-prefixed lines inside fenced code blocks", () => {
    const body = "# Real\n\n```\n# Not a heading\n```\n\n## After\n";
    expect(extractHeadingsWithSlugs(body).map((h) => h.slug)).toEqual(["real", "after"]);
  });

  // Regression: an outline entry must never resolve to a DOM id that does not
  // exist. MarkdownView renders <details>...</details> blocks in a recursive
  // pass with a fresh slug counter, so a heading inside a details block that
  // shares text with one outside would collide on slug ("intro" outside,
  // "intro-2" listed in the outline but the in-details heading is still
  // rendered as id="intro").
  it("excludes headings inside extractable <details> blocks so outline slugs match DOM ids", () => {
    const body =
      "# Intro\n\nMain body.\n\n<details open><summary>Aside</summary>\n\n## Intro\n\nNested body.\n\n</details>\n\n## After\n";
    const headings = extractHeadingsWithSlugs(body);
    expect(headings.map((h) => h.slug)).toEqual(["intro", "after"]);

    const { container } = render(<MarkdownView body={body} />);
    for (const heading of headings) {
      expect(container.querySelector(`#${heading.slug}`)).not.toBeNull();
    }
  });

  it("keeps headings inside raw (unsafe-attribute) <details> blocks since MarkdownView leaves them in the main render", () => {
    // `<details data-foo="bar">` does not pass parseDetailsOpenAttribute, so
    // MarkdownView leaves the block raw and the inner heading enters the main
    // markdown stream. Extractor must follow the same behavior.
    const body =
      '# Top\n\n<details data-foo="bar"><summary>x</summary>\n\n## Inside\n\n</details>\n';
    expect(extractHeadingsWithSlugs(body).map((h) => h.slug)).toEqual(["top", "inside"]);
  });
});
