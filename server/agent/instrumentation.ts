// Outbound HTTP instrumentation: emit CLIENT spans for the sidecar's undici/fetch
// calls (dikw-core /v1, MinerU, Tavily/Jina, the translator's Anthropic SDK) and
// inject W3C traceparent so an outbound request continues the SERVER-span trace.
//
// GATED on an OTLP traces endpoint. UndiciInstrumentation patches the global HTTP
// layer (via undici's diagnostics_channel); with no endpoint there is nothing to
// export, so we do NOT patch — outbound behavior stays byte-identical to before.
// Import + call this as early as possible in the standalone boot (before the first
// fetch). The instrumentation resolves its tracer lazily from the global provider,
// so it works even though ADK registers that provider later in boot.

import type { Attributes } from "@opentelemetry/api";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { ATTR_URL_FULL, ATTR_URL_QUERY } from "@opentelemetry/semantic-conventions";

let registered = false;

// Drop the query string from outbound CLIENT spans. MinerU's upload/result URLs
// (and presigned URLs in general) carry a bearer credential in the query, and the
// default undici instrumentation records url.full + url.query verbatim — which
// would export those credentials to the OTLP backend (and the #trace store).
// startSpanHook merges its attributes BEFORE the span is created, so the span
// never holds the credential. Clean URLs (no query) keep their default attributes.
// Matches the SERVER spans' privacy posture (they omit url.path entirely).
function redactUrlQuery(request: { origin?: string; path?: string }): Attributes {
  try {
    const url = new URL(request.path ?? "/", request.origin);
    if (!url.search) {
      return {};
    }
    return { [ATTR_URL_FULL]: `${url.origin}${url.pathname}`, [ATTR_URL_QUERY]: "[REDACTED]" };
  } catch {
    return {};
  }
}

/**
 * Register undici/fetch CLIENT-span instrumentation, but only when an OTLP traces
 * endpoint is configured. Idempotent. Returns the disable handle from
 * registerInstrumentations (used by tests); undefined when not registered.
 */
export function registerOutboundInstrumentation(): (() => void) | undefined {
  if (registered) {
    return undefined;
  }
  const tracesEnabled = Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  );
  if (!tracesEnabled) {
    return undefined;
  }
  registered = true;
  return registerInstrumentations({
    instrumentations: [new UndiciInstrumentation({ startSpanHook: redactUrlQuery })],
  });
}
