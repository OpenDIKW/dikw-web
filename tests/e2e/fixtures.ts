export const infoFixture = {
  engine_version: "0.0.1",
  base_root: "C:\\demo\\wiki",
  storage_backend: "sqlite",
  providers: {
    llm: "anthropic_compat",
    llm_model: "MiniMax-M2.7",
    embedding: "openai_compat",
    embedding_model: "Qwen3-Embedding-0.6B"
  },
  auth_required: false
};

export const healthFixture = {
  status: "ok",
  version: "0.2.0",
  base_root: "C:\\demo\\base",
  storage_engine: "sqlite",
  layer_counts: {
    sources: 1,
    knowledge_pages: 3,
    wisdom_items: 4,
    chunks: 31
  },
  providers: {
    llm: {
      provider: "anthropic_compat",
      model: "MiniMax-M2.7",
      base_url: "https://api.example.test/v1",
      max_retries: 2,
      max_tokens_query: 1024,
      max_tokens_synth: 2048,
      max_tokens_distill: 2048,
      timeout_seconds: 60,
      api_key_present: true
    },
    embedding: {
      provider: "openai_compat",
      model: "Qwen3-Embedding-0.6B",
      base_url: "https://embeddings.example.test/v1",
      dim: 1024,
      revision: "",
      normalize: true,
      distance: "cosine",
      batch_size: 96,
      max_retries: 2,
      timeout_seconds: 60,
      provider_label: "gitee",
      api_key_present: true,
      multimodal: null
    }
  }
};

export const statusFixture = {
  documents_by_layer: { source: 1, wiki: 3, wisdom: 1 },
  chunks: 31,
  embeddings: 31,
  links: 3,
  wisdom_by_status: { candidate: 1, approved: 1, archived: 0 },
  last_knowledge_log_ts: 1777819200,
  assets: 0,
  asset_embeddings: 0
};

export const wikiPagesFixture = [
  {
    doc_id: "wiki-architecture",
    path: "knowledge/concepts/architecture.md",
    path_key: "knowledge/concepts/architecture.md",
    title: "Architecture",
    hash: "hash-a",
    mtime: 1777819200,
    layer: "knowledge",
    active: true
  },
  {
    doc_id: "wiki-synthesis",
    path: "knowledge/concepts/synthesis.md",
    path_key: "knowledge/concepts/synthesis.md",
    title: "Synthesis",
    hash: "hash-s",
    mtime: 1777819300,
    layer: "knowledge",
    active: true
  },
  {
    doc_id: "wiki-orphan",
    path: "knowledge/concepts/orphan.md",
    path_key: "knowledge/concepts/orphan.md",
    title: "Orphan",
    hash: "hash-o",
    mtime: 1777819400,
    layer: "knowledge",
    active: true
  },
  {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    path_key: "sources/architecture.md",
    title: "Architecture source",
    hash: "hash-src-a",
    mtime: 1777819100,
    layer: "source",
    active: true
  },
  {
    doc_id: "source-active-learning-medium",
    path: "sources/active-learning-medium/active-learning-medium.md",
    path_key: "sources/active-learning-medium/active-learning-medium.md",
    title: "Active Learning Medium",
    hash: "hash-src-active-learning",
    mtime: 1777819500,
    layer: "source",
    active: true
  },
  {
    doc_id: "source-cho-cqa",
    path: "sources/cho-cqa/cho-cqa.md",
    path_key: "sources/cho-cqa/cho-cqa.md",
    title: "CHO CQA",
    hash: "hash-src-cho-cqa",
    mtime: 1777819600,
    layer: "source",
    active: true
  }
];

export const choCqaAssetId = "1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72";
export const choCqaMissingPath = "assets/images/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.jpg";

// 1×1 transparent PNG, base64-encoded.
export const onePxPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const graphResultFixture = {
  base_revision: "graph-rev-1",
  generated_at: "2026-05-14T10:00:00Z",
  nodes: [
    {
      id: "knowledge/concepts/architecture.md",
      path: "knowledge/concepts/architecture.md",
      title: "Architecture",
      layer: "knowledge",
      active: true,
      mtime: 1777819200,
      inbound: 0,
      outbound: 1
    },
    {
      id: "knowledge/concepts/synthesis.md",
      path: "knowledge/concepts/synthesis.md",
      title: "Synthesis",
      layer: "knowledge",
      active: true,
      mtime: 1777819300,
      inbound: 1,
      outbound: 0
    },
    {
      id: "knowledge/concepts/orphan.md",
      path: "knowledge/concepts/orphan.md",
      title: "Orphan",
      layer: "knowledge",
      active: true,
      mtime: 1777819400,
      inbound: 0,
      outbound: 0
    },
    {
      id: "sources/architecture.md",
      path: "sources/architecture.md",
      title: "Architecture source",
      layer: "source",
      active: true,
      mtime: 1777819100,
      inbound: 0,
      outbound: 0
    }
  ],
  edges: [
    {
      id: "knowledge/concepts/architecture.md->knowledge/concepts/synthesis.md",
      source: "knowledge/concepts/architecture.md",
      target: "knowledge/concepts/synthesis.md",
      type: "wikilink",
      target_text: "Synthesis",
      anchor: null,
      weight: 1
    }
  ],
  unresolved: [
    {
      source: "knowledge/concepts/architecture.md",
      target_text: "Missing Concept",
      anchor: null,
      count: 1
    }
  ],
  stats: {
    node_count: 4,
    edge_count: 1,
    unresolved_count: 1
  }
};

export const wikiPageBodiesFixture = {
  "knowledge/concepts/architecture.md": {
    doc_id: "wiki-architecture",
    path: "knowledge/concepts/architecture.md",
    layer: "knowledge",
    title: "Architecture",
    body: "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\nstatus: draft\n---\n\n# Architecture\n\nLayered DIKW notes with `inline code`.\n\n> Evidence should stay readable in dark mode.\n\n| Layer | Purpose |\n| --- | --- |\n| Knowledge | Durable notes |\n\nInline chemistry $\\mathrm { C O } _ { 2 }$ stays readable.\n\n$$x^2 + y^2 = z^2$$\n\n<table><caption>Hybrid studies</caption><thead><tr><th>First principles</th><th>Training method</th></tr></thead><tbody><tr><td>Mass balance</td><td>FBA</td></tr></tbody></table>\n\n```ts\nconst layer = \"knowledge\";\n```\n\n[Jump to links](#links)\n\n## Links\n\nSee [[Synthesis]] and [[Missing Concept]].",
    anchors: [{ chunk_id: 101, seq: 1, start: 0, end: 21 }],
    assets: [],
    frontmatter: { title: "Architecture", tags: ["DIKW"], sources: ["source/a.md"], status: "draft" }
  },
  "knowledge/concepts/synthesis.md": {
    doc_id: "wiki-synthesis",
    path: "knowledge/concepts/synthesis.md",
    layer: "knowledge",
    title: "Synthesis",
    body: "---\ntitle: Synthesis\n---\n\n# Synthesis\n\nSynthesis Body.",
    anchors: [{ chunk_id: 102, seq: 1, start: 0, end: 15 }],
    assets: []
  },
  "knowledge/concepts/orphan.md": {
    doc_id: "wiki-orphan",
    path: "knowledge/concepts/orphan.md",
    layer: "knowledge",
    title: "Orphan",
    body: "# Orphan\n\nNo graph links yet.",
    anchors: [],
    assets: []
  },
  "sources/architecture.md": {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    layer: "source",
    title: "Architecture source",
    body: "# Architecture source\n\nThe Architecture is the main topic of this source.",
    anchors: [],
    assets: []
  },
  "sources/active-learning-medium/active-learning-medium.md": {
    doc_id: "source-active-learning-medium",
    path: "sources/active-learning-medium/active-learning-medium.md",
    layer: "source",
    title: "Active Learning Medium",
    body: "# Active Learning Medium\n\n<details>\n<summary>flowchart</summary>\n\n```mermaid\ngraph LR\n    A[\"Vitamins Amino acids Metal salts etc.\"] --> B[\"Medium combinations\"]\n    B --> C[\"Incubation (37°C, 5% CO₂, 7 days)\"]\n    C --> D[\"Chemical assay, A450\"]\n```\n</details>\n\nAfter the diagram.",
    anchors: [],
    assets: []
  },
  "sources/cho-cqa/cho-cqa.md": {
    doc_id: "source-cho-cqa",
    path: "sources/cho-cqa/cho-cqa.md",
    layer: "source",
    title: "CHO CQA",
    body:
      "# CHO CQA\n\n" +
      "Fig. 2 Charge variant profile.\n\n" +
      `![[assets/images/${choCqaAssetId}.jpg]]\n\n` +
      "<details>\n<summary>bar</summary>\n\n" +
      "| Experimental runs | Acidic Variants (%) |\n" +
      "| --- | --- |\n" +
      "| Ctrl | 17 |\n" +
      "| Innovator | 25 |\n" +
      "</details>\n\n" +
      "<details>\n<summary>heatmap</summary>\n\n" +
      "| | Cu | Fe | Zn |\n" +
      "| --- | --- | --- | --- |\n" +
      "| Cu | 1.00 | 0.00 | 0.00 |\n" +
      "| Fe | 0.00 | 1.00 | -0.00 |\n" +
      "| Zn | 0.00 | -0.00 | 1.00 |\n" +
      "</details>\n\n" +
      "Missing asset:\n\n" +
      `![[${choCqaMissingPath}]]\n\n` +
      "<details>\n<summary>bar</summary>\n\n" +
      "Not a table at all.\n" +
      "</details>",
    anchors: [],
    assets: [
      {
        asset_id: choCqaAssetId,
        kind: "image",
        mime: "image/jpeg",
        bytes: 1234,
        original_paths: [`assets/images/${choCqaAssetId}.jpg`],
        media_meta: null,
        url: `/v1/assets/${choCqaAssetId}`
      }
    ]
  }
};

import type { PageLinksResult, PageProvenanceResult } from "../../src/types";

export const wikiPageLinksFixture: Record<string, PageLinksResult> = {
  "sources/architecture.md": {
    path: "sources/architecture.md",
    outgoing: [],
    incoming: [
      {
        src_doc_id: "wiki-architecture",
        src_path: "knowledge/concepts/architecture.md",
        link_type: "wikilink",
        anchor: null,
        line: 3
      }
    ]
  }
};

export const wikiPageProvenanceFixture: Record<string, PageProvenanceResult> = {
  "sources/architecture.md": {
    path: "sources/architecture.md",
    derived_from: [],
    derived_pages: [
      { doc_id: "wiki-architecture", path: "knowledge/concepts/architecture.md", title: "Architecture" },
      { doc_id: "wiki-synthesis", path: "knowledge/concepts/synthesis.md", title: "Synthesis" }
    ]
  }
};

export const hitFixture = {
  doc_id: "wiki-architecture",
  chunk_id: 101,
  seq: 1,
  score: 0.982,
  snippet: "Layered DIKW notes.",
  path: "knowledge/concepts/architecture.md",
  title: "Architecture",
  asset_refs: [],
  layer: "knowledge",
  start: 0,
  end: 21,
  text: "Layered DIKW notes."
};

export const retrieveEventsFixture = [
  { type: "retrieve_started", ts: "2026-05-05T09:00:00Z", q: "DIKW", limit: 10 },
  { type: "retrieval_done", ts: "2026-05-05T09:00:01Z", hits: [hitFixture] },
  {
    type: "final",
    ts: "2026-05-05T09:00:02Z",
    status: "succeeded",
    result: {
      chunks: [hitFixture],
      page_refs: [
        {
          path: "knowledge/concepts/architecture.md",
          layer: "knowledge",
          title: "Architecture",
          score: 0.982,
          hit_chunk_ids: [101]
        }
      ]
    }
  }
];

export const evalResultFixture = {
  dataset_name: "synthetic-diverse-v1",
  modes: ["hybrid"],
  views: ["doc"],
  passed: true,
  metrics: {
    "doc/hit_at_3": 1,
    hit_at_3: 1,
    "doc/hit_at_10": 1,
    hit_at_10: 1
  },
  thresholds: { hit_at_3: 0.9 },
  per_query: [{ q_id: "v1_tang_founding_zh" }, { q_id: "v1_negative_weather_zh" }],
  negative_diagnostics: [{ q_id: "v1_negative_weather_zh" }]
};

export const taskRowsFixture = [
  {
    task_id: "eval-task-1",
    op: "eval",
    status: "succeeded",
    created_at: "2026-05-05T09:37:11Z",
    started_at: "2026-05-05T09:37:11Z",
    finished_at: "2026-05-05T09:37:25Z",
    params_digest: "5a516df64ddbc631",
    result: evalResultFixture,
    error: null
  },
  {
    task_id: "events-bulk-1",
    op: "ingest",
    status: "succeeded",
    created_at: "2026-05-17T10:00:00Z",
    started_at: "2026-05-17T10:00:00Z",
    finished_at: "2026-05-17T10:01:00Z",
    params_digest: "bulk-evt",
    result: { added: 24 },
    error: null
  }
];

export const taskEventsFixture = [
  { type: "task_started", seq: 1, ts: "2026-05-05T09:37:11Z", task_id: "eval-task-1", op: "eval" },
  { type: "progress", seq: 2, ts: "2026-05-05T09:37:12Z", phase: "ingest", current: 1, total: 1 },
  {
    type: "progress",
    seq: 3,
    ts: "2026-05-05T09:37:15Z",
    phase: "query",
    current: 1,
    total: 2,
    detail: { mode: "hybrid", q_id: "v1_tang_founding_zh" }
  },
  { type: "final", seq: 4, ts: "2026-05-05T09:37:25Z", status: "succeeded", result: evalResultFixture, error: null }
];

export const bulkTaskEventsFixture = (() => {
  const total = 25;
  const events: Array<Record<string, unknown>> = [];
  for (let index = 0; index < total - 1; index += 1) {
    events.push({
      type: "progress",
      seq: index + 1,
      ts: `2026-05-17T10:00:${String(index % 60).padStart(2, "0")}Z`,
      phase: "embed_chunks",
      current: index + 1,
      total: total - 1
    });
  }
  events.push({
    type: "final",
    seq: total,
    ts: "2026-05-17T10:01:00Z",
    status: "succeeded",
    result: { added: total - 1 },
    error: null
  });
  return events;
})();
