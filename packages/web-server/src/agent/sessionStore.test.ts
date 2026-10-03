// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSessionTitle, validateSessionTitle } from "./sessionStore";

describe("parseSessionTitle / validateSessionTitle", () => {
  it("trims and accepts a valid title", () => {
    expect(parseSessionTitle("  Project Review  ")).toEqual({ ok: true, title: "Project Review" });
    expect(validateSessionTitle("  Project Review  ")).toBe("Project Review");
  });

  it("rejects a blank or whitespace-only title as required", () => {
    expect(parseSessionTitle("   ")).toEqual({ ok: false, reason: "required" });
    expect(parseSessionTitle(undefined)).toEqual({ ok: false, reason: "required" });
    expect(() => validateSessionTitle("   ")).toThrow("session title is required");
  });

  it("rejects a title longer than 80 characters as too_long", () => {
    const long = "x".repeat(81);
    expect(parseSessionTitle(long)).toEqual({ ok: false, reason: "too_long" });
    expect(() => validateSessionTitle(long)).toThrow("session title is too long");
  });
});
