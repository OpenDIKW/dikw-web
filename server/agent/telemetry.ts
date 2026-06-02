import { maybeSetOtelProviders } from "@google/adk";
import { DikwSpanProcessor } from "./dikwSpanProcessor.js";
import type { SpanStore } from "./spanStore.js";

// maybeSetOtelProviders registers a process-global NodeTracerProvider and will
// not override an already-set global provider — so registering twice silently
// no-ops the second processor. Guard so we only ever register once per process.
let registered = false;

/**
 * Wires the DikwSpanProcessor into ADK's OTel setup so finished agent spans
 * land in the given (in-memory) SpanStore. Idempotent per process.
 */
export function initAgentTelemetry(store: SpanStore): void {
  // ADK captures full LLM request/response + tool I/O into span attributes by
  // default (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS defaults to "true"). The
  // #trace page only needs span structure/timing/tokens, and the curated
  // tool_event stream already carries tool I/O — so opt out of content capture
  // to avoid exposing conversation history / system prompt / raw tool results
  // through GET /agent/sessions/{id}/traces. (DikwSpanProcessor also denylists
  // those attributes as defense in depth.)
  process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = "false";
  if (registered) {
    return;
  }
  registered = true;
  maybeSetOtelProviders([{ spanProcessors: [new DikwSpanProcessor(store)] }]);
}
