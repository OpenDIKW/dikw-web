// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDikwTools, WebToolClient } from "./tools";

function findTool(tools: ReturnType<typeof createDikwTools>, name: string) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not found`);
  }
  return tool;
}

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
      if (url.pathname === "/v1/base/pages/knowledge%2Farchitecture.md") {
        return Response.json({ path: "knowledge/architecture.md", title: "Architecture", body: "# Architecture" });
      }
      return Response.json({ ok: true });
    });

    const tools = createDikwTools({ coreUrl: "http://127.0.0.1:8765", fetchImpl: fetchImpl as unknown as typeof fetch });

    const retrieve = tools.find((tool) => tool.name === "retrieve_knowledge");
    const readPage = tools.find((tool) => tool.name === "read_page");
    expect(retrieve).toBeDefined();
    expect(readPage).toBeDefined();

    const retrieveResult = await retrieve!.execute("call-1", { q: "DIKW", limit: 3 });
    const pageResult = await readPage!.execute("call-2", { path: "knowledge/architecture.md" });

    expect(retrieveResult.details).toEqual({ chunks: [], page_refs: [] });
    expect(pageResult.details).toMatchObject({ path: "knowledge/architecture.md", title: "Architecture" });
    expect(calls.map((call) => call.path)).toContain("/v1/retrieve");
    expect(calls.map((call) => call.path)).toContain("/v1/base/pages/knowledge%2Farchitecture.md");
    expect(calls.map((call) => call.path)).not.toContain("/v1/query");
  });

  it("offers maintenance proposal actions without the dead distill op", () => {
    const tools = createDikwTools({ coreUrl: "http://127.0.0.1:8765" });
    const action = (
      findTool(tools, "propose_maintenance_action").parameters as {
        properties: { action: { anyOf?: Array<{ const?: string }> } };
      }
    ).properties.action;
    const literals = (action.anyOf ?? []).map((entry) => entry.const);
    expect(literals).toEqual(["ingest", "synth", "lint_propose"]);
  });
});

// Brave is retained as dead code (WebToolClient.search). Not exposed via the agent
// tool list anymore — Tavily owns the "web_search" tool now. Tests exercise the
// class method directly so the implementation does not silently rot.
describe("WebToolClient.search (Brave, retained dead-code path)", () => {
  function makeBraveResponse(results: Array<{ title: string; url: string; description: string; age?: string }>) {
    return Response.json({ web: { results } });
  }

  function makeClient(opts: { braveApiKey?: string; fetchImpl: typeof fetch }) {
    return new WebToolClient({ coreUrl: "http://127.0.0.1:8765", ...opts });
  }

  it("calls Brave Search with subscription header, query, count and freshness", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return makeBraveResponse([
        { title: "Result A", url: "https://example.com/a", description: "desc a" },
        { title: "Result B", url: "https://example.com/b", description: "desc b" }
      ]);
    });

    const client = makeClient({ braveApiKey: "brave-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await client.search("DIKW", 2, "pw");

    expect(out).toMatchObject({
      query: "DIKW",
      results: [
        { title: "Result A", url: "https://example.com/a", description: "desc a" },
        { title: "Result B", url: "https://example.com/b", description: "desc b" }
      ]
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(calls[0].url.searchParams.get("q")).toBe("DIKW");
    expect(calls[0].url.searchParams.get("count")).toBe("2");
    expect(calls[0].url.searchParams.get("freshness")).toBe("pw");

    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    expect(headers.get("X-Subscription-Token")).toBe("brave-secret");
    expect(headers.get("Accept")).toContain("application/json");
  });

  it("truncates long descriptions to 500 characters", async () => {
    const longDesc = "x".repeat(900);
    const fetchImpl = vi.fn(async () =>
      makeBraveResponse([{ title: "Long", url: "https://example.com/long", description: longDesc }])
    );
    const client = makeClient({ braveApiKey: "brave-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await client.search("q", 5);
    expect(out.results[0].description.length).toBeLessThanOrEqual(500);
    expect(out.results[0].description.endsWith("…")).toBe(true);
  });

  it("throws a clear error without leaking the value when brave key is missing", async () => {
    const fetchImpl = vi.fn();
    const client = makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.search("DIKW", 5)).rejects.toThrow(/DIKW_AGENT_BRAVE_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces the status code without forwarding the response body when Brave returns non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const client = makeClient({ braveApiKey: "brave-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.search("DIKW", 5)).rejects.toThrow(/^upstream 429$/);
  });
});

describe("web_fetch tool", () => {
  it("calls Jina Reader with bearer header and encoded URL", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return new Response("# Title\n\nbody here", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    });

    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await findTool(tools, "web_fetch").execute("call-1", { url: "https://example.com/page?x=1" });

    expect(out.details).toMatchObject({
      url: "https://example.com/page?x=1",
      content: "# Title\n\nbody here",
      truncated: false
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe("https://r.jina.ai");
    expect(calls[0].url.pathname + calls[0].url.search).toContain(encodeURIComponent("https://example.com/page?x=1"));
    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer jina-secret");
    expect(headers.get("X-Return-Format")).toBe("markdown");
  });

  it("rejects non http(s) urls with a parameter error and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(findTool(tools, "web_fetch").execute("call-1", { url: "ftp://example.com" })).rejects.toThrow(
      /http or https/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("truncates content over 50 KB and flags truncated=true", async () => {
    const big = "a".repeat(60_000);
    const fetchImpl = vi.fn(async () => new Response(big, { status: 200 }));
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await findTool(tools, "web_fetch").execute("call-1", { url: "https://example.com/big" });
    const details = out.details as { content: string; truncated: boolean };
    expect(details.truncated).toBe(true);
    expect(details.content.length).toBeLessThanOrEqual(50_000);
  });

  it("flags truncated=true and trims content when the agent text payload would exceed the budget", async () => {
    // 30 KB fits under the Jina cap (50 KB) but blows past the agent text budget (12 KB).
    const medium = "z".repeat(30_000);
    const fetchImpl = vi.fn(async () => new Response(medium, { status: 200 }));
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const out = await findTool(tools, "web_fetch").execute("call-1", { url: "https://example.com/med" });
    const details = out.details as { content: string; truncated: boolean };
    const agentText = (out.content as Array<{ text: string }>)[0].text;
    expect(details.truncated).toBe(true);
    expect(details.content.length).toBeLessThan(30_000);
    expect(agentText.length).toBeLessThanOrEqual(12_000);
    expect(() => JSON.parse(agentText)).not.toThrow();
  });

  it("throws a clear error without leaking the value when jina key is missing", async () => {
    const fetchImpl = vi.fn();
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(findTool(tools, "web_fetch").execute("call-1", { url: "https://example.com/x" })).rejects.toThrow(
      /DIKW_AGENT_JINA_API_KEY/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["http://localhost/admin"],
    ["http://127.0.0.1:8765/v1/health"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://10.0.0.1/internal"],
    ["http://192.168.1.1/router"],
    ["http://172.16.0.5/jenkins"],
    ["http://[::1]/internal"],
    ["http://[::ffff:127.0.0.1]/loop"],
    ["http://[::ffff:7f00:1]/loop"],
    ["http://example.local/printer"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["https://user:pass@example.com/secret?token=abc"]
  ])("rejects unsafe url %s and never calls fetch", async (badUrl) => {
    const fetchImpl = vi.fn();
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(findTool(tools, "web_fetch").execute("call-1", { url: badUrl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates the user abort signal to the upstream fetch", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      capturedSignal = (init?.signal as AbortSignal) ?? null;
      return new Response("body", { status: 200 });
    });
    const tools = createDikwTools({
      coreUrl: "http://127.0.0.1:8765",
      jinaApiKey: "jina-secret",
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await findTool(tools, "web_fetch").execute("call-1", { url: "https://example.com/x" });
    expect(capturedSignal).not.toBeNull();
    controller.abort();
    expect(capturedSignal!.aborted).toBe(true);
  });
});

describe("web_search tool (Tavily)", () => {
  function makeTools(opts: { tavilyApiKey?: string; fetchImpl: typeof fetch }) {
    return createDikwTools({ coreUrl: "http://127.0.0.1:8765", ...opts });
  }

  it("POSTs Tavily with api_key, query, max_results and JSON headers", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return Response.json({
        query: "DIKW",
        results: [
          { title: "Result A", url: "https://example.com/a", content: "snippet a", score: 0.9 },
          { title: "Result B", url: "https://example.com/b", content: "snippet b", score: 0.8 }
        ]
      });
    });

    const tools = makeTools({ tavilyApiKey: "tavily-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await findTool(tools, "web_search").execute("call-1", { q: "DIKW", count: 2 });

    expect(out.details).toMatchObject({
      query: "DIKW",
      results: [
        { title: "Result A", url: "https://example.com/a", description: "snippet a" },
        { title: "Result B", url: "https://example.com/b", description: "snippet b" }
      ]
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.tavily.com/search");
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ api_key: "tavily-secret", query: "DIKW", max_results: 2 });
  });

  it("truncates long content (description) to 500 characters", async () => {
    const longContent = "x".repeat(900);
    const fetchImpl = vi.fn(async () =>
      Response.json({
        query: "q",
        results: [{ title: "Long", url: "https://example.com/long", content: longContent }]
      })
    );
    const tools = makeTools({ tavilyApiKey: "tavily-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await findTool(tools, "web_search").execute("call-1", { q: "q" });
    const desc = (out.details as { results: Array<{ description: string }> }).results[0].description;
    expect(desc.length).toBeLessThanOrEqual(500);
    expect(desc.endsWith("…")).toBe(true);
  });

  it("throws a clear error without leaking the value when tavily key is missing", async () => {
    const fetchImpl = vi.fn();
    const tools = makeTools({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const tool = findTool(tools, "web_search");
    await expect(tool.execute("call-1", { q: "DIKW" })).rejects.toThrow(/DIKW_AGENT_TAVILY_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops Tavily results whose URL would target an internal or unsafe host", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        query: "q",
        results: [
          { title: "good", url: "https://example.com/a", content: "ok" },
          { title: "metadata", url: "http://169.254.169.254/", content: "x" },
          { title: "loopback", url: "http://localhost/", content: "x" },
          { title: "creds", url: "https://u:p@example.com/", content: "x" },
          { title: "xss", url: "javascript:1", content: "x" }
        ]
      })
    );
    const tools = makeTools({ tavilyApiKey: "tavily-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await findTool(tools, "web_search").execute("call-1", { q: "q" });
    const details = out.details as { results: Array<{ url: string }> };
    expect(details.results.map((r) => r.url)).toEqual(["https://example.com/a"]);
  });

  it("returns empty results when Tavily body is malformed", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        query: "q",
        results: [null, "string", 7, { url: "https://example.com/a", title: "A", content: "d" }]
      })
    );
    const tools = makeTools({ tavilyApiKey: "tavily-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await findTool(tools, "web_search").execute("call-1", { q: "q" });
    expect((out.details as { results: Array<{ url: string }> }).results).toEqual([
      { title: "A", url: "https://example.com/a", description: "d" }
    ]);
  });

  it("returns empty results when Tavily results field is not an array", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ query: "q", results: null }));
    const tools = makeTools({ tavilyApiKey: "tavily-secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await findTool(tools, "web_search").execute("call-1", { q: "q" });
    expect((out.details as { results: unknown[] }).results).toEqual([]);
  });

  it("wraps upstream non-2xx with status code only and never forwards the response body", async () => {
    const reflected = `{"api_key":"tvly-secret-leak","query":"DIKW"}`;
    const fetchImpl = vi.fn(async () => new Response(reflected, { status: 502 }));
    const tools = makeTools({ tavilyApiKey: "tvly-secret-leak", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(findTool(tools, "web_search").execute("call-1", { q: "DIKW" })).rejects.toThrow(/^upstream 502$/);
    try {
      await findTool(tools, "web_search").execute("call-1", { q: "DIKW" });
    } catch (error) {
      expect((error as Error).message).not.toContain("tvly-secret-leak");
    }
  });
});
