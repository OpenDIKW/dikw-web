export const infoFixture = {
  engine_version: "0.0.1",
  wiki_root: "C:\\demo\\wiki",
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
    sources: 2,
    wiki_pages: 2,
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
  documents_by_layer: { source: 2, wiki: 2, wisdom: 1 },
  chunks: 31,
  embeddings: 31,
  links: 3,
  wisdom_by_status: { candidate: 1, approved: 1, archived: 0 },
  last_wiki_log_ts: 1777819200,
  assets: 0,
  asset_embeddings: 0
};

export const wikiPagesFixture = [
  {
    doc_id: "wiki-architecture",
    path: "wiki/architecture.md",
    path_key: "wiki/architecture.md",
    title: "Architecture",
    hash: "hash-a",
    mtime: 1777819200,
    layer: "wiki",
    active: true
  },
  {
    doc_id: "wiki-synthesis",
    path: "wiki/synthesis.md",
    path_key: "wiki/synthesis.md",
    title: "Synthesis",
    hash: "hash-s",
    mtime: 1777819300,
    layer: "wiki",
    active: true
  }
];

export const wikiPageBodiesFixture = {
  "wiki/architecture.md": {
    doc_id: "wiki-architecture",
    path: "wiki/architecture.md",
    layer: "wiki",
    title: "Architecture",
    body: "---\ntitle: Architecture\ntags:\n- DIKW\n---\n\n# Architecture\n\nLayered DIKW notes.\n\nSee [[Synthesis]].",
    anchors: [{ chunk_id: 101, seq: 1, start: 0, end: 21 }]
  },
  "wiki/synthesis.md": {
    doc_id: "wiki-synthesis",
    path: "wiki/synthesis.md",
    layer: "wiki",
    title: "Synthesis",
    body: "---\ntitle: Synthesis\n---\n\n# Synthesis\n\nSynthesis Body.",
    anchors: [{ chunk_id: 102, seq: 1, start: 0, end: 15 }]
  }
};

export const wisdomItemsFixture = [
  {
    item_id: "wisdom-1",
    kind: "principle",
    status: "candidate",
    path: "wiki/architecture.md",
    title: "Prefer evidence",
    body: "Prefer cited evidence over unsupported summaries.",
    confidence: 0.86,
    created_ts: 1777819200,
    approved_ts: null
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
