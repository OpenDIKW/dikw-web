// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Schema } from "@google/genai";
import { createDikwTools } from "./adkTools";

function findTool(tools: ReturnType<typeof createDikwTools>, name: string) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not found`);
  }
  return tool;
}

// FunctionTool keeps `parameters` private; reach it for schema assertions.
function paramsSchema(tool: ReturnType<typeof createDikwTools>[number]): Schema {
  return (tool as unknown as { parameters: Schema }).parameters;
}

describe("ADK DIKW tools", () => {
  it("constructs all nine tools and exposes their names", () => {
    const tools = createDikwTools({ coreUrl: "http://127.0.0.1:8765" });
    expect(tools.map((tool) => tool.name)).toEqual([
      "dikw_health",
      "retrieve_knowledge",
      "list_pages",
      "read_page",
      "page_links",
      "list_wisdom",
      "web_search",
      "web_fetch",
      "propose_maintenance_action",
    ]);
  });

  it("retrieve_knowledge parses the /v1/retrieve NDJSON final event and returns the bare result", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      if (url.pathname === "/v1/retrieve") {
        return new Response(
          [
            JSON.stringify({ type: "retrieve_started", ts: "now", q: "DIKW", limit: 3 }),
            JSON.stringify({
              type: "final",
              ts: "now",
              status: "succeeded",
              result: { chunks: [], page_refs: [{ path: "knowledge/a.md" }] },
            }),
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return Response.json({ ok: true });
    });

    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "retrieve_knowledge").runAsync({
      args: { q: "DIKW", limit: 3 },
      toolContext: {} as never,
    });

    expect(out).toEqual({ chunks: [], page_refs: [{ path: "knowledge/a.md" }] });
    expect(calls).toContain("/v1/retrieve");
    expect(calls).not.toContain("/v1/query");
  });

  it("read_page hits /v1/base/pages/{encoded} and returns the bare JSON", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      if (url.pathname === "/v1/base/pages/knowledge%2Farchitecture.md") {
        return Response.json({
          path: "knowledge/architecture.md",
          title: "Architecture",
          body: "# Architecture",
        });
      }
      return Response.json({ ok: true });
    });

    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "read_page").runAsync({
      args: { path: "knowledge/architecture.md" },
      toolContext: {} as never,
    });

    expect(out).toMatchObject({ path: "knowledge/architecture.md", title: "Architecture" });
    expect(calls).toContain("/v1/base/pages/knowledge%2Farchitecture.md");
  });

  it("propose_maintenance_action returns a bare proposal and enumerates exactly the three actions", async () => {
    const tools = createDikwTools({ coreUrl: "http://127.0.0.1:8765" });
    const tool = findTool(tools, "propose_maintenance_action");

    const schema = paramsSchema(tool);
    expect(schema.properties?.action.enum).toEqual(["ingest", "synth", "lint_propose"]);

    const out = await tool.runAsync({
      args: { action: "ingest", description: "reindex", params: { force: true } },
      toolContext: {} as never,
    });
    expect(out).toEqual({
      proposal: { action: "ingest", description: "reindex", params: { force: true } },
    });

    const empty = await tool.runAsync({
      args: { action: "synth", description: "synthesize" },
      toolContext: {} as never,
    });
    expect(empty).toEqual({ proposal: { action: "synth", description: "synthesize", params: {} } });
  });

  it("web_fetch returns the bare { url, content, truncated } with 12KB-budget trimming applied", async () => {
    const medium = "z".repeat(30_000);
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return new Response(medium, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    });

    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = (await findTool(tools, "web_fetch").runAsync({
      args: { url: "https://example.com/med" },
      toolContext: {} as never,
    })) as { url: string; content: string; truncated: boolean };

    expect(out.url).toBe("https://example.com/med");
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThan(30_000);
    // Bare-details object must serialize within the 12 KB agent budget.
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12_000);
    expect(Object.keys(out).sort()).toEqual(["content", "truncated", "url"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe("https://r.jina.ai");
    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer jina-secret");
    expect(headers.get("X-Return-Format")).toBe("markdown");
  });

  it("web_fetch keeps a quote/backslash-heavy payload within the 12KB serialized budget", async () => {
    // Every char serializes to 2 chars (\" and \\), so slicing by raw length
    // would overflow once JSON-escaped. The trim must budget against the
    // serialized object, not the raw content length.
    const heavy = '"\\'.repeat(15_000); // 30 000 chars; 60 000 once escaped
    const fetchImpl = vi.fn(
      async () =>
        new Response(heavy, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    );

    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = (await findTool(tools, "web_fetch").runAsync({
      args: { url: "https://example.com/heavy" },
      toolContext: {} as never,
    })) as { url: string; content: string; truncated: boolean };

    expect(out.truncated).toBe(true);
    // The FINAL serialized object — not the raw content — must fit the budget.
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12_000);
    expect(Object.keys(out).sort()).toEqual(["content", "truncated", "url"]);
  });

  it("web_fetch returns a caught { error } for an unsafe url and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "web_fetch").runAsync({
      args: { url: "http://169.254.169.254/latest/meta-data/" },
      toolContext: {} as never,
    });
    expect(out).toMatchObject({ error: expect.stringMatching(/private, loopback, or link-local/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("web_search returns bare { query, results } from Tavily", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        query: "DIKW",
        results: [
          { title: "Result A", url: "https://example.com/a", content: "snippet a", score: 0.9 },
          { title: "Result B", url: "https://example.com/b", content: "snippet b", score: 0.8 },
        ],
      }),
    );
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      tavilyApiKey: "tavily-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "web_search").runAsync({
      args: { q: "DIKW", count: 2 },
      toolContext: {} as never,
    });
    expect(out).toEqual({
      query: "DIKW",
      results: [
        { title: "Result A", url: "https://example.com/a", description: "snippet a" },
        { title: "Result B", url: "https://example.com/b", description: "snippet b" },
      ],
    });
  });

  it("web_search returns a caught { error } (not a throw) when the Tavily key is missing", async () => {
    const fetchImpl = vi.fn();
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "web_search").runAsync({
      args: { q: "DIKW" },
      toolContext: {} as never,
    });
    expect(out).toMatchObject({ error: expect.stringMatching(/DIKW_AGENT_TAVILY_API_KEY/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not leak the upstream response body in a caught error", async () => {
    const reflected = `{"api_key":"tvly-secret-leak","query":"DIKW"}`;
    const fetchImpl = vi.fn(async () => new Response(reflected, { status: 502 }));
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      tavilyApiKey: "tvly-secret-leak",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = (await findTool(tools, "web_search").runAsync({
      args: { q: "DIKW" },
      toolContext: {} as never,
    })) as { error: string };
    expect(out.error).toBe("upstream 502");
    expect(out.error).not.toContain("tvly-secret-leak");
  });

  it("dikw_health returns the bare health JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ status: "ok", layer_counts: { wisdom: 3 } }),
    );
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await findTool(tools, "dikw_health").runAsync({
      args: {},
      toolContext: {} as never,
    });
    expect(out).toEqual({ status: "ok", layer_counts: { wisdom: 3 } });
  });
});
