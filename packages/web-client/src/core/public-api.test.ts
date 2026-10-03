import { afterEach, expect, it, vi } from "vitest";
import { DikwClient } from "@opendikw/web-client/core";

afterEach(() => vi.unstubAllGlobals());

it("preserves the core URL, bearer header and JSON result through the public package", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new DikwClient({ baseUrl: "https://core.invalid", token: "test-token" });
  await expect(client.get("/v1/health")).resolves.toEqual({ status: "ok" });
  const [input, init] = fetchMock.mock.calls[0];
  expect(String(input)).toBe("https://core.invalid/v1/health");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
});
