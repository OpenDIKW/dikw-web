export type Layer = "source" | "knowledge" | "wisdom";
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
  base_root: string;
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
  knowledge_pages: number;
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
  max_tokens_synth: number;
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
  last_knowledge_log_ts: number | null;
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

export type AssetKind = "image" | "audio" | "video" | "document" | "other";

export interface MediaMeta {
  width?: number | null;
  height?: number | null;
  format?: string | null;
}

export interface PageAsset {
  asset_id: string;
  kind: AssetKind | string;
  mime: string;
  bytes: number;
  original_paths: string[];
  media_meta: MediaMeta | null;
  url: string;
}

export interface PageReadResult {
  doc_id: string;
  path: string;
  layer: Layer;
  title: string | null;
  body: string;
  anchors: PageAnchor[];
  assets: PageAsset[];
  // Server-parsed YAML frontmatter (dikw-core 0.4.0+). Optional on the web side:
  // core always returns it (defaults to {}), but keeping it optional spares the
  // many existing PageReadResult mocks from a required-field churn.
  frontmatter?: Record<string, unknown>;
}

export type LinkType = "wikilink" | "markdown" | "url";
export type LinkDirection = "in" | "out" | "both";

export interface OutgoingLink {
  dst_path: string;
  link_type: LinkType;
  anchor: string | null;
  line: number;
}

export interface IncomingLink {
  src_doc_id: string;
  src_path: string;
  link_type: LinkType;
  anchor: string | null;
  line: number;
}

export interface PageLinksResult {
  path: string;
  outgoing: OutgoingLink[];
  incoming: IncomingLink[];
}

export interface DerivedPage {
  doc_id: string;
  path: string;
  title: string | null;
}

export interface PageProvenanceResult {
  path: string;
  derived_from: DerivedPage[];
  derived_pages: DerivedPage[];
}

export interface CoreGraphNode {
  id: string;
  path: string;
  title: string | null;
  layer: Layer;
  active: boolean;
  mtime: number;
  inbound: number;
  outbound: number;
}

export interface CoreGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  target_text: string;
  anchor: string | null;
  weight: number;
}

export interface CoreGraphUnresolvedLink {
  source: string;
  target_text: string;
  anchor: string | null;
  count: number;
}

export interface CoreGraphStats {
  node_count: number;
  edge_count: number;
  unresolved_count: number;
}

export interface GraphResult {
  base_revision: string;
  generated_at: string;
  nodes: CoreGraphNode[];
  edges: CoreGraphEdge[];
  unresolved: CoreGraphUnresolvedLink[];
  stats: CoreGraphStats;
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

// ---- Import + lint contracts (mirror dikw-core server pydantic models) ----

export interface RejectedPackage {
  id: number;
  code: string;
  detail?: Record<string, unknown> | null;
}

export interface ImportResponse {
  import_id: string;
  files_count: number;
  bytes: number;
  applied_at: string;
  committed: number[];
  rejected: RejectedPackage[];
}

export interface TaskHandle {
  task_id: string;
  op: string;
  status: TaskStatus;
  created_at: string;
  links: Record<string, string>;
}

export type LintKind =
  | "broken_wikilink"
  | "orphan_page"
  | "duplicate_title"
  | "non_atomic_page"
  | "missing_provenance";

export type FixOperationKind =
  | "create_page"
  | "update_page"
  | "delete_page"
  | "reconcile_provenance";

export interface FixOperation {
  kind: FixOperationKind;
  path: string;
  new_frontmatter?: Record<string, unknown> | null;
  new_body?: string | null;
  expected_hash?: string | null;
  source_paths?: string[] | null;
}

export interface FixProposal {
  proposal_id: string;
  issue_kind: LintKind;
  issue_path: string;
  issue_detail: string;
  issue_line?: number | null;
  operations: FixOperation[];
  rationale: string;
  source: "heuristic" | "llm";
}

export interface FixProposalReport {
  proposals: FixProposal[];
  skipped: Array<Record<string, unknown>>;
}

export interface ApplyReport {
  applied: FixOperation[];
  skipped: Array<Record<string, unknown>>;
  knowledge_paths_changed: string[];
  proposal_task_id?: string | null;
}

export interface IngestError {
  path: string;
  kind: "parse_error" | "read_error" | "storage_error";
  message: string;
}

export interface TaskRowSummary {
  task_id: string;
  op: string;
  status: TaskStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  params_digest: string;
}

export interface TaskRow extends TaskRowSummary {
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

export interface TaskListPage {
  tasks: TaskRowSummary[];
  next_cursor: string | null;
  has_more: boolean;
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

export interface EventsPage {
  task_id: string;
  task_status: TaskStatus;
  events: TaskEvent[];
  next_from_seq: number;
  has_more: boolean;
  last_seq: number;
}

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
