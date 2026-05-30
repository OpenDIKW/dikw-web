import { describe, expect, it } from "vitest";
import { isSelectableExt } from "./import-extensions";

describe("isSelectableExt", () => {
  it("always accepts markdown and image/pdf assets", () => {
    for (const ext of [".md", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf"]) {
      expect(isSelectableExt(ext, false)).toBe(true);
      expect(isSelectableExt(ext, true)).toBe(true);
    }
  });

  it("accepts office formats only when mineru is enabled", () => {
    for (const ext of [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]) {
      expect(isSelectableExt(ext, true)).toBe(true);
      expect(isSelectableExt(ext, false)).toBe(false);
    }
  });

  it("rejects unknown extensions regardless of mineru", () => {
    for (const ext of [".exe", ".zip", ".txt", ".json", ""]) {
      expect(isSelectableExt(ext, true)).toBe(false);
      expect(isSelectableExt(ext, false)).toBe(false);
    }
  });
});
