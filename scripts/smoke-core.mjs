#!/usr/bin/env node
// Contract smoke test against a LIVE dikw-core.
//
// The Playwright e2e suite mocks /v1 entirely (see tests/e2e/mockApi.ts), so it
// can never catch contract drift in the real core — e.g. the 0.4.0
// wiki -> knowledge layer rename, or /v1/tasks switching to an envelope. This
// script asserts the subset of the /v1 contract that dikw-web actually consumes
// (see docs/core-contract.md) against a running core, and exits non-zero on
// drift. It is intentionally NOT a vitest/playwright test and never runs in CI;
// run it manually when a core is reachable (before a demo, or after a dikw-core
// bump). Node's global fetch ignores HTTP_PROXY, so localhost needs no --noproxy.
//
// Usage:
//   node scripts/smoke-core.mjs [baseUrl]
//   baseUrl default: $DIKW_SMOKE_CORE_URL or http://127.0.0.1:8765
//   optional bearer token: $DIKW_SMOKE_CORE_TOKEN

const baseUrl = (process.argv[2] || process.env.DIKW_SMOKE_CORE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const token = process.env.DIKW_SMOKE_CORE_TOKEN || "";
const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

const KNOWN_LAYERS = new Set(["source", "knowledge", "wisdom"]);
const results = [];

// Kept consistent with WikiPage.encodePath: encode each segment, keep slashes.
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path) {
  // 10s timeout so a stalled core fails fast instead of hanging the script.
  const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail: detail || "" });
  } catch (error) {
    results.push({ ok: false, name, detail: error.message });
  }
}

async function main() {
  // Reachability first: fail fast and clearly rather than reporting N failures.
  try {
    await getJson("/v1/health");
  } catch (error) {
    console.error(`✖ dikw-core unreachable at ${baseUrl}: ${error.message}`);
    console.error("  Start a core, or pass the URL: node scripts/smoke-core.mjs http://host:port");
    process.exit(2);
  }

  await check("GET /v1/health: layer_counts + providers", async () => {
    const health = await getJson("/v1/health");
    assert(health.layer_counts && typeof health.layer_counts === "object", "missing layer_counts");
    for (const key of ["sources", "knowledge_pages", "wisdom_items", "chunks"]) {
      assert(key in health.layer_counts, `layer_counts.${key} missing`);
    }
    assert(health.providers && typeof health.providers === "object", "missing providers");
    // Overview renders providers.llm/embedding {provider, model}; a missing role crashes it.
    for (const role of ["llm", "embedding"]) {
      const provider = health.providers[role];
      assert(provider && typeof provider === "object", `providers.${role} missing`);
      for (const key of ["provider", "model"]) {
        assert(key in provider, `providers.${role}.${key} missing`);
      }
    }
    return `version=${health.version} engine=${health.storage_engine}`;
  });

  // Only the counters Overview actually reads (chunks comes from health.layer_counts,
  // not status; documents_by_layer is not consumed). See OverviewPage.tsx.
  await check("GET /v1/status: counters consumed by Overview", async () => {
    const status = await getJson("/v1/status");
    for (const key of ["embeddings", "links", "assets", "asset_embeddings", "last_knowledge_log_ts"]) {
      assert(key in status, `status.${key} missing`);
    }
    return `links=${status.links} assets=${status.assets}`;
  });

  await check("GET /v1/info: auth posture", async () => {
    const info = await getJson("/v1/info");
    assert("auth_required" in info, "info.auth_required missing");
    return `auth_required=${info.auth_required}`;
  });

  let readablePath = null;
  await check("GET /v1/base/pages?active=true: layers subset of {source,knowledge,wisdom}; K is 'knowledge'", async () => {
    const pages = await getJson("/v1/base/pages?active=true");
    assert(Array.isArray(pages), "expected an array of pages");
    assert(pages.length > 0, "no active pages (need a non-empty base to smoke)");
    const layers = new Set();
    for (const page of pages) {
      assert("layer" in page && "path" in page, "page missing layer/path");
      layers.add(page.layer);
      assert(KNOWN_LAYERS.has(page.layer), `unexpected layer "${page.layer}"`);
    }
    // The app filters Base to layer === "knowledge"; a regression to the
    // pre-0.4.0 "wiki" value would silently empty the K layer.
    assert(!layers.has("wiki"), "found legacy 'wiki' layer — 0.4.0 renamed it to 'knowledge'");
    const readable = pages.find((page) => page.layer === "knowledge" || page.layer === "source");
    readablePath = (readable || pages[0]).path;
    return `layers=${[...layers].sort().join(",")} n=${pages.length}`;
  });

  await check("GET /v1/base/pages/{path}: PageReadResult incl. frontmatter", async () => {
    assert(readablePath, "no page path resolved from the list");
    const page = await getJson(`/v1/base/pages/${encodePath(readablePath)}`);
    for (const key of ["doc_id", "path", "layer", "title", "body", "anchors", "assets", "frontmatter"]) {
      assert(key in page, `PageReadResult.${key} missing`);
    }
    assert(Array.isArray(page.assets), "PageReadResult.assets must be an array");
    return `path=${page.path}`;
  });

  // toKnowledgeGraph (src/utils/graph.ts) consumes nodes/edges/unresolved and
  // stats.{node_count,edge_count,unresolved_count}; base_revision/generated_at
  // are metadata the app does not render, so they are not asserted.
  await check("GET /v1/base/graph?active=true: nodes/edges/unresolved/stats", async () => {
    const graph = await getJson("/v1/base/graph?active=true");
    for (const key of ["nodes", "edges", "unresolved", "stats"]) {
      assert(key in graph, `graph.${key} missing`);
    }
    assert(
      Array.isArray(graph.nodes) && Array.isArray(graph.edges) && Array.isArray(graph.unresolved),
      "graph nodes/edges/unresolved must be arrays"
    );
    for (const key of ["node_count", "edge_count", "unresolved_count"]) {
      assert(key in graph.stats, `graph.stats.${key} missing`);
    }
    if (graph.nodes.length) {
      for (const key of ["id", "layer"]) assert(key in graph.nodes[0], `graph node missing "${key}"`);
    }
    return `nodes=${graph.nodes.length} edges=${graph.edges.length}`;
  });

  await check("GET /v1/tasks: TaskListPage envelope (not a bare array)", async () => {
    const tasks = await getJson("/v1/tasks");
    assert(!Array.isArray(tasks), "tasks endpoint must return an envelope, not a bare array");
    for (const key of ["tasks", "next_cursor", "has_more"]) {
      assert(key in tasks, `TaskListPage.${key} missing`);
    }
    assert(Array.isArray(tasks.tasks), "TaskListPage.tasks must be an array");
    return `has_more=${tasks.has_more}`;
  });

  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✖"} ${result.name}${result.detail ? `  — ${result.detail}` : ""}`);
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} contract checks passed against ${baseUrl}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`smoke-core crashed: ${error.stack || error}`);
  process.exit(3);
});
