import { maybeSetOtelProviders } from "@google/adk";
import { DikwSpanProcessor } from "./dikwSpanProcessor.js";
import { SpanStore } from "./spanStore.js";
import { buildDikwResource } from "./telemetryResource.js";

// One process-global SpanStore + provider registration, shared by every entry
// point. maybeSetOtelProviders sets a process-global NodeTracerProvider and
// no-ops a second registration, so the store must be owned here: whichever
// handler is created first (e.g. a /web request before any /agent request in
// the dev server) registers the provider, and the agent handler serves #trace
// spans from this same instance.
let sharedStore: SpanStore | null = null;

/**
 * Registers the DikwSpanProcessor (+ the dikw-web Resource) into ADK's OTel
 * setup and returns the process-global in-memory SpanStore the #trace UI reads.
 * Idempotent: the provider is registered once; later calls return the same
 * store.
 *
 * The Resource is passed as the 2nd arg so ADK merges our span processor with
 * its own env-gated OTLP exporters (active only when OTEL_EXPORTER_OTLP_ENDPOINT
 * / *_TRACES_ENDPOINT is set) — any OTLP-exported span then carries our
 * service.name/version/instance.id. With no endpoint env this is a no-op for
 * export: only the in-memory SpanStore (the #trace UI) is fed, exactly as
 * before.
 */
export function initAgentTelemetry(): SpanStore {
  // ADK captures full LLM request/response + tool I/O into span attributes by
  // default (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS defaults to "true"). The
  // #trace page only needs span structure/timing/tokens, and the curated
  // tool_event stream already carries tool I/O — so opt out of content capture
  // to avoid exposing conversation history / system prompt / raw tool results
  // through GET /agent/sessions/{id}/traces. (DikwSpanProcessor also denylists
  // those attributes as defense in depth.)
  process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = "false";
  if (sharedStore) {
    return sharedStore;
  }
  const store = new SpanStore();
  maybeSetOtelProviders([{ spanProcessors: [new DikwSpanProcessor(store)] }], buildDikwResource());
  sharedStore = store;
  return store;
}
