// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sourcesFromTool } from "./runtime";

describe("sourcesFromTool", () => {
  it("maps retrieve_knowledge page_refs to core sources", () => {
    const sources = sourcesFromTool("retrieve_knowledge", {
      page_refs: [
        { path: "wiki/architecture.md", title: "Architecture", layer: "wiki", score: 0.42 },
        { path: "" }
      ]
    });
    expect(sources).toEqual([
      { path: "wiki/architecture.md", title: "Architecture", layer: "wiki", score: 0.42 }
    ]);
  });

  it("maps web_search results to web sources", () => {
    const sources = sourcesFromTool("web_search", {
      query: "DIKW",
      results: [
        { title: "A", url: "https://example.com/a", description: "desc a" },
        { title: "B", url: "https://example.com/b", description: "desc b" },
        { title: "missing url", description: "no url" }
      ]
    });
    expect(sources).toEqual([
      { path: "https://example.com/a", title: "A", excerpt: "desc a", layer: null, score: null, kind: "web" },
      { path: "https://example.com/b", title: "B", excerpt: "desc b", layer: null, score: null, kind: "web" }
    ]);
  });

  it("emits a single web source for web_fetch results", () => {
    const sources = sourcesFromTool("web_fetch", {
      url: "https://example.com/page",
      title: "Example",
      content: "hello",
      truncated: false
    });
    expect(sources).toEqual([
      {
        path: "https://example.com/page",
        title: "Example",
        excerpt: null,
        layer: null,
        score: null,
        kind: "web"
      }
    ]);
  });

  it("returns no sources for unrelated tools", () => {
    expect(sourcesFromTool("dikw_health", { ok: true })).toEqual([]);
    expect(sourcesFromTool("propose_maintenance_action", { proposal: { action: "ingest" } })).toEqual([]);
  });

  it("drops web_search results whose url is private, loopback, javascript:, or has embedded credentials", () => {
    const sources = sourcesFromTool("web_search", {
      query: "DIKW",
      results: [
        { title: "good", url: "https://example.com/a", description: "ok" },
        { title: "loopback", url: "http://localhost/admin", description: "x" },
        { title: "metadata", url: "http://169.254.169.254/", description: "x" },
        { title: "private", url: "http://10.0.0.1/", description: "x" },
        { title: "xss", url: "javascript:alert(1)", description: "x" },
        { title: "creds", url: "https://u:p@example.com/", description: "x" },
        { title: "no url", description: "x" }
      ]
    });
    expect(sources.map((s) => s.path)).toEqual(["https://example.com/a"]);
  });

  it("drops web_fetch sources whose url fails validation", () => {
    expect(sourcesFromTool("web_fetch", { url: "http://localhost/x" })).toEqual([]);
    expect(sourcesFromTool("web_fetch", { url: "javascript:1" })).toEqual([]);
    expect(sourcesFromTool("web_fetch", { url: "" })).toEqual([]);
  });
});
