import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { renderMarkdown, type MarkdownContext } from "./markdown-runtime";

const EMPTY_CTX: MarkdownContext = {
  assets: [],
  assetBaseUrl: "http://127.0.0.1:8765",
  assetToken: "",
};

const URL_ATTRS = new Set(["href", "src", "action", "formaction", "data-asset-src"]);
const FORBIDDEN_TAGS = "script, iframe, object, embed, style, form, base, meta";

function assertSanitizedDom(html: string): void {
  const container = document.createElement("div");
  container.innerHTML = html;

  expect(container.querySelectorAll(FORBIDDEN_TAGS)).toHaveLength(0);

  for (const svg of container.querySelectorAll("svg")) {
    // Only KaTeX math layout emits legitimate inline SVG glyphs.
    expect(svg.closest(".katex")).not.toBeNull();
  }

  for (const el of container.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      expect(name.startsWith("on")).toBe(false);
      if (URL_ATTRS.has(name)) {
        const value = attr.value.trim().toLowerCase();
        expect(value).not.toMatch(/^(?:javascript|vbscript):/);
        expect(value).not.toMatch(/^data:\s*text\/html/);
      }
    }
  }
}

const adversarialFragmentArb = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.constantFrom(
    `<script>alert(1)</script>`,
    `<img src="x" onerror="alert(1)">`,
    `<svg onload="alert(1)"><script>x</script></svg>`,
    `<iframe src="javascript:alert(1)"></iframe>`,
    `<a href="javascript:alert(1)">click</a>`,
    `[click](javascript:alert(1))`,
    `![alt](javascript:alert(1))`,
    `![[evil" onerror="alert(1)|label]]`,
    `[[target" onclick="alert(1)|label]]`,
    `<details open onclick="alert(1)"><summary onmouseover="alert(1)">S</summary><script>x</script></details>`,
    `<table onclick="alert(1)"><tr><td onmouseover="alert(2)">10<sup>2</sup><script>x</script></td></tr></table>`,
    `H<sub>2</sub>O and x<sup><script>alert(1)</script></sup>`,
    `$$\\sqrt{x^2 + 1}$$`,
    `<style>body{display:none}</style>`,
    `<object data="data:text/html,<script>alert(1)</script>"></object>`,
  ),
);

describe("renderMarkdown property invariants", () => {
  it("never emits forbidden tags, inline event handlers, or executable URLs for arbitrary input", () => {
    fc.assert(
      fc.property(
        fc
          .array(adversarialFragmentArb, { minLength: 1, maxLength: 6 })
          .map((parts) => parts.join("\n\n")),
        (body) => {
          const html = renderMarkdown(body, EMPTY_CTX);
          expect(typeof html).toBe("string");
          assertSanitizedDom(html);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("never throws or emits unsafe DOM when adversarial payloads are nested inside details/tables", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        adversarialFragmentArb,
        fc.boolean(),
        (summary, inner, open) => {
          const openAttr = open ? ' open onclick="alert(1)"' : ' onmouseover="alert(2)"';
          const doc = [
            `<details${openAttr}><summary>${summary}</summary>\n${inner}\n</details>`,
            `<table border="1" onclick="alert(3)"><tr><th>${summary}</th><td>${inner}</td></tr></table>`,
          ].join("\n\n");
          const html = renderMarkdown(doc, EMPTY_CTX);
          assertSanitizedDom(html);
        },
      ),
      { numRuns: 120 },
    );
  });
});
