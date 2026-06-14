import { describe, expect, it, vi } from "vitest";
import { loadTelemetry, resolveTelemetry } from "./telemetry";

describe("resolveTelemetry", () => {
  it("resolves an endpoint with headers", () => {
    const result = resolveTelemetry({
      telemetry: { endpoint: "https://collector.example.com/v1/traces", headers: { "x-key": "v" } },
    });
    expect(result).toEqual({
      endpoint: "https://collector.example.com/v1/traces",
      headers: { "x-key": "v" },
    });
  });

  it("resolves an endpoint-only config (no headers)", () => {
    const result = resolveTelemetry({ telemetry: { endpoint: "https://c.example/v1/traces" } });
    expect(result).toEqual({ endpoint: "https://c.example/v1/traces" });
  });

  it("trims surrounding whitespace from the endpoint", () => {
    const result = resolveTelemetry({ telemetry: { endpoint: "  https://c/v1/traces  " } });
    expect(result).toEqual({ endpoint: "https://c/v1/traces" });
  });

  it("drops non-string header values, keeping the string ones", () => {
    const result = resolveTelemetry({
      telemetry: { endpoint: "https://c/v1/traces", headers: { ok: "yes", bad: 42, also: null } },
    });
    expect(result).toEqual({ endpoint: "https://c/v1/traces", headers: { ok: "yes" } });
  });

  it("omits headers entirely when none are strings", () => {
    const result = resolveTelemetry({
      telemetry: { endpoint: "https://c/v1/traces", headers: { bad: 1 } },
    });
    expect(result).toEqual({ endpoint: "https://c/v1/traces" });
  });

  it.each([
    ["null", null],
    ["a number", 7],
    ["a bare string", "nope"],
    ["missing telemetry", {}],
    ["telemetry of wrong type", { telemetry: 5 }],
    ["empty endpoint", { telemetry: { endpoint: "" } }],
    ["whitespace-only endpoint", { telemetry: { endpoint: "   " } }],
    ["endpoint of wrong type", { telemetry: { endpoint: 123 } }],
    ["telemetry without endpoint", { telemetry: { headers: { a: "b" } } }],
  ])("returns null for malformed input (%s)", (_label, raw) => {
    expect(resolveTelemetry(raw)).toBeNull();
  });
});

describe("loadTelemetry", () => {
  function stubFetch(impl: () => Promise<Response>): void {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("resolves telemetry from a valid config.json", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ telemetry: { endpoint: "https://c/v1/traces" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(await loadTelemetry()).toEqual({ endpoint: "https://c/v1/traces" });
  });

  it("returns null on a 404", async () => {
    stubFetch(() => Promise.resolve(new Response("not found", { status: 404 })));
    expect(await loadTelemetry()).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    expect(await loadTelemetry()).toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response("<!doctype html><title>app</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );
    expect(await loadTelemetry()).toBeNull();
  });

  it("returns null when config.json has no telemetry block", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ brand: { name: "Acme" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(await loadTelemetry()).toBeNull();
  });

  it("returns null when the fetch never settles (timeout)", async () => {
    vi.useFakeTimers();
    try {
      stubFetch(() => new Promise<Response>(() => {}));
      const pending = loadTelemetry();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
