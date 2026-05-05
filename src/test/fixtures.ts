import type {
  DocumentRecord,
  Hit,
  InfoResponse,
  QueryStreamEvent,
  ReadyResponse,
  RetrieveStreamEvent,
  StorageCounts,
  TaskEvent,
  TaskRow,
  WikiPageResponse,
  WisdomItem
} from "../types";

export const infoFixture: InfoResponse = {
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

export const readyFixture: ReadyResponse = {
  status: "ready",
  wiki_root: "C:\\demo\\wiki"
};

export const statusFixture: StorageCounts = {
  documents_by_layer: { source: 2, wiki: 2, wisdom: 1 },
  chunks: 31,
  embeddings: 31,
  links: 3,
  wisdom_by_status: { candidate: 1, approved: 1, archived: 0 },
  last_wiki_log_ts: 1777819200,
  assets: 0,
  asset_embeddings: 0
};

export const wikiPagesFixture: DocumentRecord[] = [
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

export const wikiPageBodiesFixture: Record<string, WikiPageResponse> = {
  "wiki/architecture.md": {
    path: "wiki/architecture.md",
    body: "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\n---\n\n# Architecture\n\nLayered DIKW notes.\n\nSee [[Synthesis]]."
  },
  "wiki/synthesis.md": {
    path: "wiki/synthesis.md",
    body: "---\ntitle: Synthesis\n---\n\n# Synthesis\n\nSynthesis Body."
  }
};

export const hitFixture: Hit = {
  doc_id: "wiki-architecture",
  chunk_id: 101,
  seq: 1,
  score: 0.982,
  snippet: "Layered DIKW notes.",
  path: "wiki/architecture.md",
  title: "Architecture",
  asset_refs: [],
  layer: "wiki",
  start: 0,
  end: 21,
  text: "Layered DIKW notes."
};

export const queryEventsFixture: QueryStreamEvent[] = [
  { type: "query_started", ts: "2026-05-05T09:00:00Z", q: "What is DIKW?", limit: 5 },
  { type: "retrieval_done", ts: "2026-05-05T09:00:01Z", hits: [hitFixture] },
  { type: "llm_token", ts: "2026-05-05T09:00:02Z", delta: "Layered " },
  { type: "llm_token", ts: "2026-05-05T09:00:03Z", delta: "answer." },
  {
    type: "final",
    ts: "2026-05-05T09:00:04Z",
    status: "succeeded",
    result: {
      answer: "Layered answer.",
      citations: [
        {
          n: 1,
          path: "wiki/architecture.md",
          title: "Architecture",
          layer: "wiki",
          seq: 1,
          excerpt: "Layered DIKW notes."
        }
      ],
      applied_wisdom: [
        {
          ref: "W1",
          item_id: "wisdom-1",
          kind: "principle",
          title: "Prefer evidence"
        }
      ]
    }
  }
];

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
          path: "wiki/architecture.md",
          layer: "wiki",
          title: "Architecture",
          score: 0.982,
          hit_chunk_ids: [101]
        }
      ]
    }
  }
];

export const wisdomItemsFixture: WisdomItem[] = [
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
    hit_at_10: 1,
    mrr: 1,
    recall_at_100: 1
  },
  thresholds: {
    hit_at_3: 0.9
  },
  per_query: [{ q_id: "v1_tang_founding_zh" }, { q_id: "v1_negative_weather_zh" }],
  negative_diagnostics: [{ q_id: "v1_negative_weather_zh" }]
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
    error: null
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
    error: null
  }
];

export const taskEventsFixture: TaskEvent[] = [
  {
    type: "task_started",
    seq: 1,
    ts: "2026-05-05T09:37:11Z",
    task_id: "eval-task-1",
    op: "eval"
  },
  {
    type: "progress",
    seq: 2,
    ts: "2026-05-05T09:37:12Z",
    phase: "ingest",
    current: 1,
    total: 1
  },
  {
    type: "progress",
    seq: 3,
    ts: "2026-05-05T09:37:15Z",
    phase: "query",
    current: 1,
    total: 2,
    detail: { mode: "hybrid", q_id: "v1_tang_founding_zh" }
  },
  {
    type: "final",
    seq: 4,
    ts: "2026-05-05T09:37:25Z",
    status: "succeeded",
    result: evalResultFixture,
    error: null
  }
];

export async function* createAsyncEvents<T>(events: T[]): AsyncGenerator<T> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}
