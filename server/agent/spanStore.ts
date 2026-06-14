import type {
  SessionTraceView,
  TraceInvocationView,
  TraceSpanView,
} from "../../src/agent/traceTypes.js";

/**
 * Flat span row extracted from a finished OTel span by DikwSpanProcessor.
 * One row per ADK span; the SpanStore re-assembles these into the per-session
 * SessionTraceView the #trace UI renders.
 */
export interface SpanRow {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTimeMs: number;
  durationMs: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
  /** Resolved from gcp.vertex.agent.session_id / gen_ai.conversation.id; null on the root invocation span. */
  sessionId: string | null;
  /** Resolved from gcp.vertex.agent.invocation_id; null on spans that carry none. */
  invocationId: string | null;
  tokensInput?: number;
  tokensOutput?: number;
}

// Cap total retained spans so a long-lived sidecar doesn't grow unbounded.
// #trace is a hidden, ephemeral observability view — silently evicting the
// oldest spans is acceptable (we have no logger here to warn on eviction).
const MAX_SPANS = 5000;

/**
 * In-memory, bounded span store. Lives in the long-lived sidecar process; spans
 * are LOST on a sidecar restart by design (conversation content stays sourced
 * from the persistent sqlite session store — only spans are ephemeral).
 */
export class SpanStore {
  private readonly rows: SpanRow[] = [];

  record(row: SpanRow): void {
    this.rows.push(row);
    if (this.rows.length > MAX_SPANS) {
      // Evict oldest (FIFO) to stay within the cap.
      this.rows.splice(0, this.rows.length - MAX_SPANS);
    }
  }

  getSessionTraces(sessionId: string): SessionTraceView {
    // Spans directly attributed to this session.
    const sessionRows = this.rows.filter((row) => row.sessionId === sessionId);
    // Re-attach root `invocation` spans (sessionId === null) that share a traceId
    // with one of the session's spans — the ADK root span carries no session id.
    const traceIds = new Set(sessionRows.map((row) => row.traceId));
    const rootRows = this.rows.filter((row) => row.sessionId === null && traceIds.has(row.traceId));
    const rows = [...sessionRows, ...rootRows];

    // Resolve each span's invocation. Spans carry an invocationId directly; the
    // root `invocation` span does not, so map its traceId → the (single)
    // invocationId seen on other spans of that trace. If a trace has no
    // invocationId anywhere, such spans group under their traceId.
    const invocationByTrace = new Map<string, string>();
    for (const row of rows) {
      if (row.invocationId && !invocationByTrace.has(row.traceId)) {
        invocationByTrace.set(row.traceId, row.invocationId);
      }
    }
    const groups = new Map<string, SpanRow[]>();
    for (const row of rows) {
      const key = row.invocationId ?? invocationByTrace.get(row.traceId) ?? row.traceId;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        groups.set(key, [row]);
      }
    }

    const invocations: TraceInvocationView[] = [];
    for (const [invocationId, bucket] of groups) {
      // A span whose parent isn't present in this view is a root here. Notably the
      // inbound SERVER span (Phase 2) parents ADK's `invocation` span but is
      // filtered out of the store by DikwSpanProcessor, so its id must not leak as
      // a dangling parent — normalize it (and any FIFO-evicted parent) to null to
      // honor the TraceSpanView root invariant.
      const presentIds = new Set(bucket.map((row) => row.spanId));
      const spans = bucket
        .map((row) => toSpanView(row, presentIds))
        .sort((a, b) => a.startTimeMs - b.startTimeMs);
      const startTimeMs = Math.min(...spans.map((span) => span.startTimeMs));
      const endTimeMs = Math.max(...spans.map((span) => span.startTimeMs + span.durationMs));
      invocations.push({
        invocationId,
        startTimeMs,
        durationMs: endTimeMs - startTimeMs,
        spans,
      });
    }

    invocations.sort((a, b) => a.startTimeMs - b.startTimeMs);
    return { sessionId, invocations };
  }
}

function toSpanView(row: SpanRow, presentIds: Set<string>): TraceSpanView {
  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId && presentIds.has(row.parentSpanId) ? row.parentSpanId : null,
    name: row.name,
    startTimeMs: row.startTimeMs,
    durationMs: row.durationMs,
    status: row.status,
    attributes: row.attributes,
    ...(typeof row.tokensInput === "number" ? { tokensInput: row.tokensInput } : {}),
    ...(typeof row.tokensOutput === "number" ? { tokensOutput: row.tokensOutput } : {}),
  };
}
