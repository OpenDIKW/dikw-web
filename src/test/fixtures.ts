import type {
  DocumentRecord,
  GraphResult,
  HealthReport,
  Hit,
  InfoResponse,
  PageReadResult,
  RetrieveStreamEvent,
  StorageCounts,
  TaskEvent,
  TaskListPage,
  TaskRow,
  TaskRowSummary,
} from "../types";

export const infoFixture: InfoResponse = {
  engine_version: "0.0.1",
  base_root: "C:\\demo\\base",
  storage_backend: "sqlite",
  providers: {
    llm: "anthropic_compat",
    llm_model: "MiniMax-M2.7",
    embedding: "openai_compat",
    embedding_model: "Qwen3-Embedding-0.6B",
  },
  auth_required: false,
};

export const healthFixture: HealthReport = {
  status: "ok",
  version: "0.2.0",
  base_root: "C:\\demo\\base",
  storage_engine: "sqlite",
  layer_counts: {
    sources: 2,
    knowledge_pages: 2,
    wisdom_items: 4,
    chunks: 31,
  },
  providers: {
    llm: {
      provider: "anthropic_compat",
      model: "MiniMax-M2.7",
      base_url: "https://api.example.test/v1",
      max_retries: 2,
      max_tokens_synth: 2048,
      timeout_seconds: 60,
      api_key_present: true,
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
      multimodal: null,
    },
  },
};

export const statusFixture: StorageCounts = {
  documents_by_layer: { source: 2, knowledge: 2, wisdom: 1 },
  chunks: 31,
  embeddings: 31,
  links: 3,
  last_knowledge_log_ts: 1777819200,
  assets: 0,
  asset_embeddings: 0,
};

export const wikiPagesFixture: DocumentRecord[] = [
  {
    doc_id: "knowledge-architecture",
    path: "knowledge/architecture.md",
    path_key: "knowledge/architecture.md",
    title: "Architecture",
    hash: "hash-a",
    mtime: 1777819200,
    layer: "knowledge",
    active: true,
  },
  {
    doc_id: "knowledge-synthesis",
    path: "knowledge/synthesis.md",
    path_key: "knowledge/synthesis.md",
    title: "Synthesis",
    hash: "hash-s",
    mtime: 1777819300,
    layer: "knowledge",
    active: true,
  },
];

export const sourcePagesFixture: DocumentRecord[] = [
  {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    path_key: "sources/architecture.md",
    title: "Architecture source",
    hash: "hash-src-a",
    mtime: 1777819100,
    layer: "source",
    active: true,
  },
];

export const graphResultFixture: GraphResult = {
  base_revision: "graph-rev-1",
  generated_at: "2026-05-14T10:00:00Z",
  nodes: [
    {
      id: "knowledge/architecture.md",
      path: "knowledge/architecture.md",
      title: "Architecture",
      layer: "knowledge",
      active: true,
      mtime: 1777819200,
      inbound: 0,
      outbound: 1,
    },
    {
      id: "knowledge/synthesis.md",
      path: "knowledge/synthesis.md",
      title: "Synthesis",
      layer: "knowledge",
      active: true,
      mtime: 1777819300,
      inbound: 1,
      outbound: 0,
    },
    {
      id: "knowledge/orphan.md",
      path: "knowledge/orphan.md",
      title: "Orphan",
      layer: "knowledge",
      active: true,
      mtime: 1777819400,
      inbound: 0,
      outbound: 0,
    },
    {
      id: "sources/architecture.md",
      path: "sources/architecture.md",
      title: "Architecture source",
      layer: "source",
      active: true,
      mtime: 1777819100,
      inbound: 0,
      outbound: 0,
    },
  ],
  edges: [
    {
      id: "knowledge/architecture.md->knowledge/synthesis.md",
      source: "knowledge/architecture.md",
      target: "knowledge/synthesis.md",
      type: "wikilink",
      target_text: "Synthesis",
      anchor: "Details",
      weight: 2,
    },
  ],
  unresolved: [
    {
      source: "knowledge/architecture.md",
      target_text: "Missing Concept",
      anchor: null,
      count: 2,
    },
  ],
  stats: {
    node_count: 4,
    edge_count: 1,
    unresolved_count: 2,
  },
};

export const wikiPageBodiesFixture: Record<string, PageReadResult> = {
  "knowledge/architecture.md": {
    doc_id: "knowledge-architecture",
    path: "knowledge/architecture.md",
    layer: "knowledge",
    title: "Architecture",
    body: "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\n---\n\n# Architecture\n\nLayered DIKW notes.\n\nSee [[Synthesis]].",
    anchors: [{ chunk_id: 101, seq: 1, start: 0, end: 21 }],
    assets: [],
    frontmatter: { title: "Architecture", tags: ["DIKW"], sources: ["source/a.md"] },
  },
  "knowledge/synthesis.md": {
    doc_id: "knowledge-synthesis",
    path: "knowledge/synthesis.md",
    layer: "knowledge",
    title: "Synthesis",
    body: "---\ntitle: Synthesis\n---\n\n# Synthesis\n\nSynthesis Body.",
    anchors: [{ chunk_id: 102, seq: 1, start: 0, end: 15 }],
    assets: [],
    frontmatter: { title: "Synthesis" },
  },
  "sources/architecture.md": {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    layer: "source",
    title: "Architecture source",
    // Body contains 'Architecture' (matches the K page title) but does NOT
    // contain 'Synthesis' — so Architecture should become an inline wikilink
    // and Synthesis should fall to the bottom Unlinked-references panel.
    body: "# Architecture source\n\nThe Architecture is the main topic of this source.",
    anchors: [{ chunk_id: 201, seq: 1, start: 0, end: 38 }],
    assets: [],
    frontmatter: {},
  },
};

export const hitFixture: Hit = {
  doc_id: "knowledge-architecture",
  chunk_id: 101,
  seq: 1,
  score: 0.982,
  snippet: "Layered DIKW notes.",
  path: "knowledge/architecture.md",
  title: "Architecture",
  asset_refs: [],
  layer: "knowledge",
  start: 0,
  end: 21,
  text: "Layered DIKW notes.",
};

export const retrieveEventsFixture: RetrieveStreamEvent[] = [
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
          path: "knowledge/architecture.md",
          layer: "knowledge",
          title: "Architecture",
          score: 0.982,
          hit_chunk_ids: [101],
        },
      ],
    },
  },
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
    hit_at_10: 1,
    mrr: 1,
    recall_at_100: 1,
  },
  thresholds: {
    hit_at_3: 0.9,
  },
  per_query: [{ q_id: "v1_tang_founding_zh" }, { q_id: "v1_negative_weather_zh" }],
  negative_diagnostics: [{ q_id: "v1_negative_weather_zh" }],
};

export const taskRowsFixture: TaskRow[] = [
  {
    task_id: "eval-task-1",
    op: "eval",
    status: "succeeded",
    created_at: "2026-05-05T09:37:11Z",
    started_at: "2026-05-05T09:37:11Z",
    finished_at: "2026-05-05T09:37:25Z",
    params_digest: "5a516df64ddbc631",
    result: evalResultFixture,
    error: null,
  },
  {
    task_id: "synth-task-1",
    op: "synth",
    status: "succeeded",
    created_at: "2026-05-03T15:20:10Z",
    started_at: "2026-05-03T15:20:10Z",
    finished_at: "2026-05-03T15:21:14Z",
    params_digest: "f73c45125b85",
    result: { pages: 2, created: 1 },
    error: null,
  },
];

export const manyTaskRowsFixture: TaskRow[] = Array.from({ length: 25 }, (_, index) => ({
  task_id: `bulk-task-${String(index + 1).padStart(2, "0")}`,
  op: index % 2 === 0 ? "ingest" : "synth",
  status: "succeeded",
  created_at: `2026-05-${String(10 + (index % 20)).padStart(2, "0")}T09:00:00Z`,
  started_at: `2026-05-${String(10 + (index % 20)).padStart(2, "0")}T09:00:01Z`,
  finished_at: `2026-05-${String(10 + (index % 20)).padStart(2, "0")}T09:00:05Z`,
  params_digest: `digest-${index + 1}`,
  result: { added: index + 1 },
  error: null,
}));

export function toTaskSummary(row: TaskRowSummary): TaskRowSummary {
  return {
    task_id: row.task_id,
    op: row.op,
    status: row.status,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    params_digest: row.params_digest,
  };
}

export function toTaskListPage(
  tasks: TaskRowSummary[],
  opts: { nextCursor?: string | null; hasMore?: boolean } = {},
): TaskListPage {
  return {
    tasks: tasks.map(toTaskSummary),
    next_cursor: opts.nextCursor ?? null,
    has_more: opts.hasMore ?? false,
  };
}

// Summary projections (no result/error) — what GET /v1/tasks now returns.
export const taskSummariesFixture: TaskRowSummary[] = taskRowsFixture.map(toTaskSummary);
export const manyTaskSummariesFixture: TaskRowSummary[] = manyTaskRowsFixture.map(toTaskSummary);

// Single-page envelope for the common case (everything fits, no next page).
export const taskListPageFixture: TaskListPage = toTaskListPage(taskSummariesFixture);

export const taskEventsFixture: TaskEvent[] = [
  {
    type: "task_started",
    seq: 1,
    ts: "2026-05-05T09:37:11Z",
    task_id: "eval-task-1",
    op: "eval",
  },
  {
    type: "progress",
    seq: 2,
    ts: "2026-05-05T09:37:12Z",
    phase: "ingest",
    current: 1,
    total: 1,
  },
  {
    type: "progress",
    seq: 3,
    ts: "2026-05-05T09:37:15Z",
    phase: "query",
    current: 1,
    total: 2,
    detail: { mode: "hybrid", q_id: "v1_tang_founding_zh" },
  },
  {
    type: "final",
    seq: 4,
    ts: "2026-05-05T09:37:25Z",
    status: "succeeded",
    result: evalResultFixture,
    error: null,
  },
];

export const ingestFileErrorEventsFixture: TaskEvent[] = [
  {
    type: "task_started",
    seq: 1,
    ts: "2026-05-05T09:37:11Z",
    task_id: "ingest-task-1",
    op: "ingest",
  },
  {
    type: "partial",
    seq: 2,
    ts: "2026-05-05T09:37:12Z",
    kind: "file_error",
    payload: {
      path: "sources/broken.md",
      kind: "parse_error",
      message: "invalid YAML front matter",
    },
  },
  {
    type: "final",
    seq: 3,
    ts: "2026-05-05T09:37:25Z",
    status: "succeeded",
    result: {
      scanned: 2,
      added: 1,
      updated: 0,
      unchanged: 0,
      chunks: 1,
      embedded: 0,
      errors: [
        {
          path: "sources/broken.md",
          kind: "parse_error",
          message: "invalid YAML front matter",
        },
      ],
    },
    error: null,
  },
];

export async function* createAsyncEvents<T>(events: T[]): AsyncGenerator<T> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

export function manyTaskEventsFixture(count: number): TaskEvent[] {
  const total = Math.max(1, count);
  const events: TaskEvent[] = [];
  for (let index = 0; index < total - 1; index += 1) {
    events.push({
      type: "progress",
      seq: index + 1,
      ts: `2026-05-17T10:00:${String(index % 60).padStart(2, "0")}Z`,
      phase: "embed_chunks",
      current: index + 1,
      total: total - 1,
    });
  }
  events.push({
    type: "final",
    seq: total,
    ts: "2026-05-17T10:01:00Z",
    status: "succeeded",
    result: { added: total - 1 },
    error: null,
  });
  return events;
}
