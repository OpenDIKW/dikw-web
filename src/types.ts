export type Layer = "source" | "wiki" | "wisdom";
export type WisdomKind = "principle" | "lesson" | "pattern";
export type WisdomStatus = "candidate" | "approved" | "archived";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

export interface InfoResponse {
  engine_version: string;
  wiki_root: string;
  storage_backend: string;
  providers: {
    llm: string;
    llm_model: string;
    embedding: string;
    embedding_model: string;
  };
  auth_required: boolean;
}

export interface HealthReport {
  status: "ok";
  version: string;
  base_root: string;
  storage_engine: "sqlite" | "postgres";
  layer_counts: LayerCounts;
  providers: ProvidersInfo;
}

export interface LayerCounts {
  sources: number;
  wiki_pages: number;
  wisdom_items: number;
  chunks: number;
}

export interface ProvidersInfo {
  llm: LlmInfo;
  embedding: EmbeddingInfo;
}

export interface LlmInfo {
  provider: "anthropic_compat" | "openai_compat" | "openai_codex";
  model: string;
  base_url: string | null;
  max_retries: number;
  max_tokens_query: number;
  max_tokens_synth: number;
  max_tokens_distill: number;
  timeout_seconds: number;
  api_key_present: boolean;
}

export interface EmbeddingInfo {
  provider: "openai_compat";
  model: string;
  base_url: string | null;
  dim: number;
  revision: string;
  normalize: boolean;
  distance: "cosine" | "l2" | "dot";
  batch_size: number;
  max_retries: number;
  timeout_seconds: number;
  provider_label: string | null;
  api_key_present: boolean;
  multimodal: MultimodalInfo | null;
}

export interface MultimodalInfo {
  provider: string;
  model: string;
  revision: string;
  dim: number;
  normalize: boolean;
  distance: "cosine" | "l2" | "dot";
  batch_size: number;
  base_url: string | null;
}

export interface StorageCounts {
  documents_by_layer: Record<string, number>;
  chunks: number;
  embeddings: number;
  links: number;
  wisdom_by_status: Record<string, number>;
  last_wiki_log_ts: number | null;
  assets: number;
  asset_embeddings: number;
}

export interface DocumentRecord {
  doc_id: string;
  path: string;
  path_key: string;
  title: string | null;
  hash: string;
  mtime: number;
  layer: Layer;
  active: boolean;
}

export interface PageAnchor {
  chunk_id: number;
  seq: number;
  start: number;
  end: number;
}

export interface PageReadResult {
  doc_id: string;
  path: string;
  layer: Layer;
  title: string | null;
  body: string;
  anchors: PageAnchor[];
}

export interface ChunkRecord {
  chunk_id: number | null;
  doc_id: string;
  seq: number;
  start: number;
  end: number;
  text: string;
}

export interface Hit {
  doc_id: string;
  chunk_id: number;
  seq: number | null;
  score: number;
  snippet: string | null;
  path: string | null;
  title: string | null;
  asset_refs: unknown[];
  layer: Layer | null;
  start: number | null;
  end: number | null;
  text: string | null;
}

export interface PageRef {
  path: string;
  layer: Layer | null;
  title: string | null;
  score: number;
  hit_chunk_ids: number[];
}

export interface RetrieveResult {
  chunks: Hit[];
  page_refs: PageRef[];
}

export interface Citation {
  n: number;
  path: string;
  title: string | null;
  layer: string;
  seq: number | null;
  excerpt: string;
}

export interface AppliedWisdomRef {
  ref: string;
  item_id: string;
  kind: string;
  title: string;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
  applied_wisdom: AppliedWisdomRef[];
}

export interface WisdomItem {
  item_id: string;
  kind: WisdomKind;
  status: WisdomStatus;
  path: string | null;
  title: string;
  body: string;
  confidence: number;
  created_ts: number;
  approved_ts: number | null;
}

export interface IngestError {
  path: string;
  kind: "parse_error" | "read_error" | "storage_error";
  message: string;
}

export interface TaskRow {
  task_id: string;
  op: string;
  status: TaskStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  params_digest: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

export type TaskEvent =
  | {
      type: "task_started";
      seq: number;
      ts: string;
      task_id: string;
      op: string;
    }
  | {
      type: "progress";
      seq: number;
      ts: string;
      phase: string;
      current: number;
      total: number;
      detail?: Record<string, unknown> | null;
    }
  | {
      type: "log";
      seq: number;
      ts: string;
      level: string;
      message: string;
    }
  | {
      type: "partial";
      seq: number;
      ts: string;
      kind: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "final";
      seq: number;
      ts: string;
      status: "succeeded" | "failed" | "cancelled";
      result?: Record<string, unknown> | null;
      error?: Record<string, unknown> | null;
    }
  | {
      type: "error";
      seq: number;
      ts: string;
      code: string;
      message: string;
    };

export type QueryStreamEvent =
  | { type: "query_started"; ts: string; q: string; limit: number }
  | { type: "retrieval_done"; ts: string; hits: Hit[] }
  | { type: "llm_token"; ts: string; delta: string }
  | { type: "progress"; ts: string; phase: string; current: number; total: number }
  | { type: "log"; ts: string; level: string; message: string }
  | { type: "partial"; ts: string; kind: string; payload: Record<string, unknown> }
  | {
      type: "final";
      ts: string;
      status: "succeeded";
      result: QueryResult;
    }
  | {
      type: "final";
      ts: string;
      status: "failed" | "cancelled";
      error?: { code: string; message: string; detail?: Record<string, unknown> };
    };

export type RetrieveStreamEvent =
  | { type: "retrieve_started"; ts: string; q: string; limit: number }
  | { type: "retrieval_done"; ts: string; hits: Hit[] }
  | { type: "progress"; ts: string; phase: string; current: number; total: number }
  | { type: "log"; ts: string; level: string; message: string }
  | { type: "partial"; ts: string; kind: string; payload: Record<string, unknown> }
  | {
      type: "final";
      ts: string;
      status: "succeeded";
      result: RetrieveResult;
    }
  | {
      type: "final";
      ts: string;
      status: "failed" | "cancelled";
      error?: { code: string; message: string; detail?: Record<string, unknown> };
    };
