import { describe, expect, it } from "vitest";
import { kebabSourceName, kebabStem } from "./kebab-source-name";

describe("kebabSourceName (ADR 0004 fixtures)", () => {
  it("normalizes an underscored ASCII name", () => {
    expect(kebabSourceName("CortX_Agent_Prompt_V1.md")).toBe("cortx-agent-prompt-v1.md");
  });

  it("folds a leading numeric prefix and a space", () => {
    expect(kebabSourceName("01_Biotechnology Progress.pdf")).toBe("01-biotechnology-progress.md");
  });

  it("preserves Han characters while kebab-casing the ASCII parts", () => {
    expect(kebabSourceName("AI 制药研发应用-A.pdf")).toBe("ai-制药研发应用-a.md");
  });

  it("folds a U+2010 hyphen variant and a trailing space", () => {
    // "Machine Learning‐Powered " — the separator is U+2010 (not ASCII '-'),
    // and there is a trailing space before the extension.
    expect(kebabSourceName("Machine Learning‐Powered .pdf")).toBe("machine-learning-powered.md");
  });

  it("truncates a long name so the whole filename stays under 32 code points", () => {
    const out = kebabSourceName("Hybrid deep modeling of a CHO-K1 fed-batch process.pdf");
    expect(out).toBe("hybrid-deep-modeling-of-a-ch.md");
    expect(Array.from(out).length).toBeLessThan(32);
  });

  it("falls back to untitled when nothing survives normalization", () => {
    expect(kebabSourceName("   .png")).toBe("untitled.md");
  });
});

describe("kebabStem", () => {
  it("lowercases ASCII and leaves Han caseless and intact", () => {
    expect(kebabStem("中文 Test.md")).toBe("中文-test");
  });

  it("keeps digits", () => {
    expect(kebabStem("Report 2026 v3.pdf")).toBe("report-2026-v3");
  });

  it("collapses repeated separators into a single hyphen", () => {
    expect(kebabStem("a___b   c.md")).toBe("a-b-c");
  });

  it("folds a bare U+2010 between letters", () => {
    expect(kebabStem("a‐b")).toBe("a-b");
  });

  it("caps the stem at 28 code points", () => {
    const out = kebabStem(`${"a".repeat(40)}.md`);
    expect(out).toBe("a".repeat(28));
    expect(Array.from(out).length).toBe(28);
  });

  it("re-trims a trailing hyphen exposed by truncation", () => {
    // 27 letters, then a separator, then more — the cut lands on the hyphen.
    const out = kebabStem("abcdefghijklmnopqrstuvwxyza more.md");
    expect(out).toBe("abcdefghijklmnopqrstuvwxyza");
    expect(out.endsWith("-")).toBe(false);
  });

  it("counts astral-plane letters as single code points and preserves them", () => {
    // U+20000 (CJK Ext-B) is a letter in the astral plane (2 UTF-16 units).
    expect(kebabStem("\u{20000} abc.md")).toBe("\u{20000}-abc");
  });

  it("returns untitled for an all-separator stem", () => {
    expect(kebabStem("___.md")).toBe("untitled");
  });
});
