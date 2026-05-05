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

export const readyFixture = { status: "ready", wiki_root: "C:\\demo\\wiki" };

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

export const wikiPageBodiesFixture: Record<string, { path: string; body: string }> = {
  "wiki/architecture.md": {
    path: "wiki/architecture.md",
    body: "---\ntitle: Architecture\ntags:\n- DIKW\n---\n\n# Architecture\n\nLayered DIKW notes.\n\nSee [[Synthesis]]."
  },
  "wiki/synthesis.md": {
    path: "wiki/synthesis.md",
    body: "---\ntitle: Synthesis\n---\n\n# Synthesis\n\nSynthesis Body."
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
