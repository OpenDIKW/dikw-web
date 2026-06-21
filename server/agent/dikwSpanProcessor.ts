import type { Context, HrTime } from "@opentelemetry/api";
import { SpanKind } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { recordLlmTokens } from "../shared/metrics.js";
import type { SpanStore, SpanRow } from "./spanStore.js";

const SESSION_ID_ATTRS = ["gcp.vertex.agent.session_id", "gen_ai.conversation.id"] as const;
const INVOCATION_ID_ATTR = "gcp.vertex.agent.invocation_id";
const INPUT_TOKENS_ATTR = "gen_ai.usage.input_tokens";
const OUTPUT_TOKENS_ATTR = "gen_ai.usage.output_tokens";

/**
 * OTel SpanProcessor that projects finished ADK spans into the in-memory
 * SpanStore as flat SpanRows. Only onEnd matters; the other hooks are no-ops.
 *
 * ReadableSpan shape verified for the installed @opentelemetry/sdk-trace-base
 * 2.8.x: parent span id lives on `parentSpanContext?.spanId` (NOT a flat
 * `parentSpanId` field, which earlier versions used).
 */
export class DikwSpanProcessor implements SpanProcessor {
  constructor(private readonly store: SpanStore) {}

  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    // HTTP infrastructure spans share the trace with the agent invocation but are
    // distributed-tracing plumbing for OTLP export, not agent work: the inbound
    // SERVER span (withServerSpan) and the outbound CLIENT spans
    // (instrumentation-undici). ADK's own agent spans are all INTERNAL, so keep
    // only INTERNAL in the in-memory #trace store and the waterfall stays
    // agent-only (they still export over OTLP).
    if (span.kind !== SpanKind.INTERNAL) {
      return;
    }
    const ctx = span.spanContext();
    const attributes = coerceAttributes(span.attributes);
    const sessionId = firstString(attributes, SESSION_ID_ATTRS) ?? null;
    const invocationId = stringAttr(attributes, INVOCATION_ID_ATTR) ?? null;
    const tokensInput = numberAttr(attributes, INPUT_TOKENS_ATTR);
    const tokensOutput = numberAttr(attributes, OUTPUT_TOKENS_ATTR);
    // Mirror the parsed LLM token counts into the dikw.llm.tokens metric. No-op
    // when no MeterProvider is registered (no OTLP endpoint configured).
    if (tokensInput !== undefined) {
      recordLlmTokens("input", tokensInput);
    }
    if (tokensOutput !== undefined) {
      recordLlmTokens("output", tokensOutput);
    }
    const row: SpanRow = {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      parentSpanId: span.parentSpanContext?.spanId ?? null,
      name: span.name,
      startTimeMs: hrTimeToMs(span.startTime),
      durationMs: hrTimeToMs(span.duration),
      status: statusFromCode(span.status.code),
      attributes,
      sessionId,
      invocationId,
      ...withToken("tokensInput", tokensInput),
      ...withToken("tokensOutput", tokensOutput),
    };
    this.store.record(row);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function hrTimeToMs(time: HrTime): number {
  const [seconds, nanos] = time;
  return seconds * 1000 + nanos / 1e6;
}

function statusFromCode(code: number): SpanRow["status"] {
  if (code === 1) {
    return "ok";
  }
  if (code === 2) {
    return "error";
  }
  return "unset";
}

// ADK span attributes that carry full conversation content / raw tool I/O.
// We never surface these through GET /sessions/{id}/traces (the #trace UI only
// needs structure/timing/tokens, and the tool_event stream already has tool
// I/O). Dropped here regardless of ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS, as
// defense in depth on top of disabling that capture in initAgentTelemetry.
const REDACTED_ATTRS = new Set<string>([
  "gcp.vertex.agent.llm_request",
  "gcp.vertex.agent.llm_response",
  "gcp.vertex.agent.tool_call_args",
  "gcp.vertex.agent.tool_response",
  "gcp.vertex.agent.data",
]);

// Coerce OTel AttributeValue (string | number | boolean | arrays | undefined)
// to the string|number|boolean the trace contract allows; arrays/objects are
// stringified. Sensitive content attributes (REDACTED_ATTRS) are dropped.
function coerceAttributes(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || REDACTED_ATTRS.has(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

function firstString(
  attributes: Record<string, string | number | boolean>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = stringAttr(attributes, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function stringAttr(
  attributes: Record<string, string | number | boolean>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}

function numberAttr(
  attributes: Record<string, string | number | boolean>,
  key: string,
): number | undefined {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
}

function withToken(field: "tokensInput" | "tokensOutput", value: number | undefined) {
  return value === undefined ? {} : { [field]: value };
}
