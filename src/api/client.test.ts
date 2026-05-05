import { describe, expect, it } from "vitest";
import { buildRequestUrl, normalizeBaseUrl } from "./client";

describe("DikwClient URL helpers", () => {
  it("normalizes a trailing slash", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
  });

  it("builds same-origin proxy URLs", () => {
    expect(buildRequestUrl("", "/v1/status", { limit: 10 })).toBe("/v1/status?limit=10");
  });

  it("builds absolute server URLs", () => {
    expect(buildRequestUrl("http://127.0.0.1:8765", "/v1/tasks", { status: "running" })).toBe(
      "http://127.0.0.1:8765/v1/tasks?status=running"
    );
  });
});
