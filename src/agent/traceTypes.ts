// Read model for the hidden #trace observability page. These shapes are the
// contract between the trace backend (Phase 3: an OpenTelemetry SpanProcessor
// projecting ADK spans out of SQLite) and the TracePage UI. Phase 1 renders the
// same shapes from local mock data so the layout can be reviewed before any
// backend exists.

export type TraceSpanStatus = "ok" | "error" | "unset";

export interface TraceSpanView {
  spanId: string;
  /** Parent span within the same invocation, or null for the invocation root. */
  parentSpanId: string | null;
  /** OTel span name, e.g. "invocation", "call_llm", "execute_tool retrieve_knowledge". */
  name: string;
  /** Absolute start time in epoch milliseconds. */
  startTimeMs: number;
  durationMs: number;
  status: TraceSpanStatus;
  /** Flattened span attributes (gen_ai.*, gcp.vertex.agent.*, tool args/response). */
  attributes: Record<string, string | number | boolean>;
  tokensInput?: number;
  tokensOutput?: number;
}

export interface TraceInvocationView {
  /** ADK invocationId — one runAsync call == one invocation == one trace. */
  invocationId: string;
  startTimeMs: number;
  durationMs: number;
  spans: TraceSpanView[];
}

export interface SessionTraceView {
  sessionId: string;
  invocations: TraceInvocationView[];
}
