import { describe, expect, it } from "vitest";
import { isEnglishBody } from "./lang";

describe("isEnglishBody", () => {
  it("treats English prose as English", () => {
    expect(isEnglishBody("The quick brown fox jumps over the lazy dog.")).toBe(true);
  });

  it("treats Chinese prose as not English", () => {
    expect(isEnglishBody("数据、信息、知识与智慧构成了完整的认知层级。")).toBe(false);
  });

  it("treats mostly-Chinese text with a few English terms as not English", () => {
    expect(isEnglishBody("这是关于 DIKW 模型的笔记,核心是 knowledge 层,从数据到智慧的跃迁。")).toBe(
      false,
    );
  });

  it("treats English with a light sprinkling of Chinese (<15%) as English", () => {
    expect(
      isEnglishBody(
        "This article explains the DIKW pyramid in depth. 模型 aside, the layers matter.",
      ),
    ).toBe(true);
  });

  it("counts letters only, ignoring markdown syntax", () => {
    expect(
      isEnglishBody("# Heading\n\n- item one\n- item two\n\n`code()` and [a link](http://x)."),
    ).toBe(true);
  });

  it("returns false for an empty or symbol-only body (no toggle)", () => {
    expect(isEnglishBody("")).toBe(false);
    expect(isEnglishBody("### --- ***")).toBe(false);
  });
});
