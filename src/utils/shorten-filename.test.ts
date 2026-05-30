import { describe, expect, it } from "vitest";
import { shortenFileName } from "./shorten-filename";

describe("shortenFileName", () => {
  it("leaves a short stem untouched", () => {
    expect(shortenFileName("report.pdf")).toBe("report.pdf");
  });

  it("leaves a stem of exactly the max length untouched", () => {
    const stem = "a".repeat(25);
    expect(shortenFileName(`${stem}.pdf`)).toBe(`${stem}.pdf`);
  });

  it("truncates an over-long ASCII stem and keeps the extension", () => {
    const stem = "a".repeat(40);
    expect(shortenFileName(`${stem}.docx`)).toBe(`${"a".repeat(25)}.docx`);
  });

  it("truncates a long non-ASCII stem by code point, preserving the original text", () => {
    const stem = "中".repeat(40);
    const out = shortenFileName(`${stem}.pdf`);
    expect(out).toBe(`${"中".repeat(25)}.pdf`);
  });

  it("does not split a surrogate pair at the truncation boundary", () => {
    const stem = "😀".repeat(30); // each emoji is one code point, two UTF-16 units
    const out = shortenFileName(`${stem}.pdf`);
    expect(out).toBe(`${"😀".repeat(25)}.pdf`);
    // The stem portion must contain exactly 25 whole emojis, no lone surrogate.
    expect(Array.from(out.slice(0, out.lastIndexOf(".")))).toHaveLength(25);
  });

  it("handles a name with no extension", () => {
    const stem = "x".repeat(40);
    expect(shortenFileName(stem)).toBe("x".repeat(25));
  });

  it("treats only the final dot as the extension separator", () => {
    // stem "my.report.final" is 15 chars → under the cap → unchanged.
    expect(shortenFileName("my.report.final.docx")).toBe("my.report.final.docx");
  });

  it("operates on the basename when a path is present", () => {
    const stem = "b".repeat(40);
    expect(shortenFileName(`some/dir/${stem}.pdf`)).toBe(`${"b".repeat(25)}.pdf`);
  });

  it("respects a custom maxStem", () => {
    expect(shortenFileName("abcdefghij.md", 4)).toBe("abcd.md");
  });
});
