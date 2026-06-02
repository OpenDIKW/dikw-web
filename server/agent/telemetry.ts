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
  if (registered) {
    return;
  }
  registered = true;
  maybeSetOtelProviders([{ spanProcessors: [new DikwSpanProcessor(store)] }]);
}
