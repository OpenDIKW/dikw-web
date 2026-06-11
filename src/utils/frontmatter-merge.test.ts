import { describe, expect, it } from "vitest";
import { mergeFrontmatter } from "./frontmatter-merge";

describe("mergeFrontmatter", () => {
  it("prepends a fresh block when the file has no frontmatter", () => {
    const out = mergeFrontmatter("# Heading\n\nbody\n", { original_filename: "My File.pdf" });
    expect(out).toBe('---\noriginal_filename: "My File.pdf"\n---\n# Heading\n\nbody\n');
  });

  it("adds converter only when provided", () => {
    const out = mergeFrontmatter("# H\n", {
      original_filename: "x.pdf",
      converter: "mineru",
    });
    expect(out).toBe('---\noriginal_filename: "x.pdf"\nconverter: "mineru"\n---\n# H\n');
  });

  it("does not inject a converter key for a plain .md", () => {
    const out = mergeFrontmatter("# H\n", { original_filename: "x.md" });
    expect(out).not.toContain("converter");
  });

  it("inserts missing keys into an existing block without touching author keys", () => {
    const out = mergeFrontmatter("---\ntitle: Foo\n---\nbody\n", { original_filename: "x.md" });
    expect(out).toBe('---\ntitle: Foo\noriginal_filename: "x.md"\n---\nbody\n');
  });

  it("never clobbers an existing original_filename", () => {
    const text = '---\noriginal_filename: "orig.md"\n---\nbody\n';
    expect(mergeFrontmatter(text, { original_filename: "new.md" })).toBe(text);
  });

  it("leaves the text unchanged when every wanted key is already present", () => {
    const text = '---\noriginal_filename: "a.pdf"\nconverter: "mineru"\n---\nbody\n';
    expect(mergeFrontmatter(text, { original_filename: "b", converter: "mineru" })).toBe(text);
  });

  it("leaves an unterminated frontmatter block byte-identical", () => {
    const text = "---\ntitle: x\nno closing fence here";
    expect(mergeFrontmatter(text, { original_filename: "x.md" })).toBe(text);
  });

  it("preserves CRLF line endings when inserting", () => {
    const out = mergeFrontmatter("---\r\ntitle: Foo\r\n---\r\nbody\r\n", {
      original_filename: "x.md",
    });
    expect(out).toBe('---\r\ntitle: Foo\r\noriginal_filename: "x.md"\r\n---\r\nbody\r\n');
  });

  it("treats an indented key as nested, not a top-level match", () => {
    const out = mergeFrontmatter("---\nmeta:\n  original_filename: nested\n---\nb\n", {
      original_filename: "x.md",
    });
    expect(out).toBe(
      '---\nmeta:\n  original_filename: nested\noriginal_filename: "x.md"\n---\nb\n',
    );
  });

  it("does not treat a key with a longer name as our key", () => {
    const out = mergeFrontmatter("---\noriginal_filename_v2: y\n---\nb\n", {
      original_filename: "x.md",
    });
    expect(out).toBe('---\noriginal_filename_v2: y\noriginal_filename: "x.md"\n---\nb\n');
  });

  it("escapes quotes and backslashes in the value", () => {
    const out = mergeFrontmatter("# H\n", { original_filename: 'a"b\\c.md' });
    expect(out).toBe('---\noriginal_filename: "a\\"b\\\\c.md"\n---\n# H\n');
  });

  it("injects into an empty frontmatter block (--- immediately followed by ---)", () => {
    const out = mergeFrontmatter("---\n---\n# Title\n", { original_filename: "x.md" });
    expect(out).toBe('---\noriginal_filename: "x.md"\n---\n# Title\n');
  });

  it("injects into an empty CRLF frontmatter block", () => {
    const out = mergeFrontmatter("---\r\n---\r\n# T\r\n", { original_filename: "x.md" });
    expect(out).toBe('---\r\noriginal_filename: "x.md"\r\n---\r\n# T\r\n');
  });
});
