// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDikwTools } from "./tools";

describe("DIKW agent tools", () => {
  it("calls retrieve and page APIs through dikw-core without using /v1/query", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname + url.search, init });
      if (url.pathname === "/v1/retrieve") {
        return new Response(
          [
            JSON.stringify({ type: "retrieve_started", ts: "now", q: "DIKW", limit: 3 }),
            JSON.stringify({
              type: "final",
              ts: "now",
              status: "succeeded",
              result: { chunks: [], page_refs: [] }
            })
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } }
        );
      }
      if (url.pathname === "/v1/base/pages/wiki%2Farchitecture.md") {
        return Response.json({ path: "wiki/architecture.md", title: "Architecture", body: "# Architecture" });
      }
      return Response.json({ ok: true });
    });

    const tools = createDikwTools({ coreUrl: "http://127.0.0.1:8765", fetchImpl: fetchImpl as unknown as typeof fetch });

    const retrieve = tools.find((tool) => tool.name === "retrieve_knowledge");
    const readPage = tools.find((tool) => tool.name === "read_page");
    expect(retrieve).toBeDefined();
    expect(readPage).toBeDefined();

    const retrieveResult = await retrieve!.execute("call-1", { q: "DIKW", limit: 3 });
    const pageResult = await readPage!.execute("call-2", { path: "wiki/architecture.md" });

    expect(retrieveResult.details).toEqual({ chunks: [], page_refs: [] });
    expect(pageResult.details).toMatchObject({ path: "wiki/architecture.md", title: "Architecture" });
    expect(calls.map((call) => call.path)).toContain("/v1/retrieve");
    expect(calls.map((call) => call.path)).toContain("/v1/base/pages/wiki%2Farchitecture.md");
    expect(calls.map((call) => call.path)).not.toContain("/v1/query");
  });
});
