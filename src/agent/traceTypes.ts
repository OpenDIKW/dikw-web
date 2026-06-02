// Read model for the hidden #trace observability page. These shapes are the
// contract between the trace backend (Phase 3: an OpenTelemetry SpanProcessor
// projecting ADK spans into an in-memory, bounded SpanStore in the sidecar —
// ephemeral, lost on restart) and the TracePage UI, which fetches them live via
// AgentClient.getSessionTraces. The same shapes also back the local mock
// fixtures used by the unit/e2e tests.

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
