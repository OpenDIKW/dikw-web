import { describe, expect, it, vi } from "vitest";
import { defaultBranding, loadBranding, resolveBranding } from "./branding";

describe("resolveBranding", () => {
  it("applies a full per-locale name override", () => {
    const result = resolveBranding({ brand: { name: { en: "Maibo-DIKW", "zh-CN": "迈博知识库" } } });
    expect(result.name).toEqual({ en: "Maibo-DIKW", "zh-CN": "迈博知识库" });
  });

  it("treats a bare string as the same name for every locale", () => {
    const result = resolveBranding({ brand: { name: "Acme" } });
    expect(result.name).toEqual({ en: "Acme", "zh-CN": "Acme" });
  });

  it("falls back per locale when the override is partial", () => {
    const result = resolveBranding({ brand: { name: { en: "Acme" } } });
    expect(result.name).toEqual({ en: "Acme", "zh-CN": defaultBranding.name["zh-CN"] });
  });

  it("ignores empty or non-string locale values", () => {
    const result = resolveBranding({ brand: { name: { en: "", "zh-CN": 42 } } });
    expect(result.name).toEqual(defaultBranding.name);
  });

  it.each([
    ["null", null],
    ["a number", 7],
    ["a bare string", "nope"],
    ["missing brand", {}],
    ["brand without name", { brand: {} }],
    ["name of wrong type", { brand: { name: 5 } }]
  ])("returns defaults for malformed input (%s)", (_label, raw) => {
    expect(resolveBranding(raw)).toEqual(defaultBranding);
  });
});

describe("loadBranding", () => {
  function stubFetch(impl: () => Promise<Response>): void {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("resolves branding from a valid config.json", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ brand: { name: { en: "Maibo-DIKW", "zh-CN": "迈博知识库" } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    const result = await loadBranding();
    expect(result.name).toEqual({ en: "Maibo-DIKW", "zh-CN": "迈博知识库" });
  });

  it("falls back to defaults on a 404", async () => {
    stubFetch(() => Promise.resolve(new Response("not found", { status: 404 })));
    expect(await loadBranding()).toEqual(defaultBranding);
  });

  it("falls back to defaults when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    expect(await loadBranding()).toEqual(defaultBranding);
  });

  it("falls back to defaults when the body is not JSON", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response("<!doctype html><title>app</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })
      )
    );
    expect(await loadBranding()).toEqual(defaultBranding);
  });
});
