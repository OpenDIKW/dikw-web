import type { TelemetryConfig } from "../config/telemetry";

// service.name for browser RUM spans — kept distinct from the sidecar's
// "dikw-web" so frontend and backend signals are separable, while the W3C trace
// context still stitches a browser span to the sidecar's SERVER span.
const BROWSER_SERVICE_NAME = "dikw-web-browser";

let initialized = false;

/**
 * Initialize browser RUM (OpenTelemetry web tracing), but only when a telemetry
 * endpoint is configured in public/config.json. The heavy OTel web SDK is pulled
 * in via dynamic import() so it lives in a lazy chunk and never enters the default
 * entry bundle — a deployment that doesn't opt in downloads none of it.
 *
 * Scope: document-load + fetch instrumentation only. Both work correctly with this
 * fire-and-forget bootstrap — document-load reads the persisted Navigation Timing
 * entries, and the fetch patch wraps the app's ongoing calls. The user-interaction
 * instrumentation is deliberately NOT registered: it only wraps listeners added
 * after it loads, but React attaches its delegated listeners at render — before this
 * async init resolves — so it would miss them; fixing that would mean loading zone.js
 * (which globally patches Promise/setTimeout/requestAnimationFrame) before React and
 * Pixi mount, an unjustified risk for click-span coverage. The default
 * StackContextManager (registered by register()) is enough for fetch propagation.
 *
 * Best-effort and idempotent: any load/registration failure is swallowed so RUM can
 * neither break the app nor emit console noise (the e2e console gate fails on any
 * console.error / pageerror).
 */
export async function initBrowserOtel(config: TelemetryConfig | null): Promise<void> {
  if (initialized || !config) {
    return;
  }
  initialized = true;
  try {
    const [
      { WebTracerProvider, BatchSpanProcessor },
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { registerInstrumentations },
      { DocumentLoadInstrumentation },
      { FetchInstrumentation },
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-web"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
      import("@opentelemetry/instrumentation"),
      import("@opentelemetry/instrumentation-document-load"),
      import("@opentelemetry/instrumentation-fetch"),
    ]);

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: BROWSER_SERVICE_NAME }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: config.endpoint, headers: config.headers }),
        ),
      ],
    });
    // No contextManager arg → the default StackContextManager, enough for the
    // synchronous fetch/document-load context (no zone.js).
    provider.register();

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        // traceparent is propagated to same-origin requests by default — which
        // always includes the sidecar's /agent + /web, stitching the browser span
        // into the Phase 2 SERVER span. A cross-origin core (the standalone
        // deployment's /v1) is not propagated to and triggers no CORS preflight; a
        // same-origin-proxied core would receive a traceparent, which is harmless
        // (it carries only trace/span ids). ignoreUrls excludes the exporter's own
        // collector POSTs so span export is never itself traced.
        new FetchInstrumentation({ ignoreUrls: [config.endpoint] }),
      ],
    });
  } catch {
    // best-effort: RUM must never break the app.
  }
}
