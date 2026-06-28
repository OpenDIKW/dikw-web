// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDevProxyTarget } from "./vitePlugin";

describe("resolveDevProxyTarget", () => {
  it("returns a trimmed absolute http(s) URL", () => {
    expect(resolveDevProxyTarget("http://127.0.0.1:57609")).toBe("http://127.0.0.1:57609");
    expect(resolveDevProxyTarget("  https://core.example.com  ")).toBe("https://core.example.com");
  });

  it("returns undefined when unset or blank", () => {
    expect(resolveDevProxyTarget(undefined)).toBeUndefined();
    expect(resolveDevProxyTarget("")).toBeUndefined();
    expect(resolveDevProxyTarget("   ")).toBeUndefined();
  });

  it("returns undefined for a malformed target (missing scheme)", () => {
    expect(resolveDevProxyTarget("127.0.0.1:57609")).toBeUndefined();
  });

  it("returns undefined for a non-http(s) target", () => {
    expect(resolveDevProxyTarget("ftp://core.example.com")).toBeUndefined();
  });
});
