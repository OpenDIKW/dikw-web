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
 * Best-effort and idempotent: any load/registration failure is swallowed so RUM
 * can neither break the app nor emit console noise (the e2e console gate fails on
 * any console.error / pageerror).
 */
export async function initBrowserOtel(config: TelemetryConfig | null): Promise<void> {
  if (initialized || !config) {
    return;
  }
  initialized = true;
  try {
    // ZoneContextManager and the user-interaction instrumentation rely on a global
    // Zone; zone.js patches async primitives so spans propagate across event and
    // promise boundaries. Loaded here, inside the opt-in lazy chunk, never eagerly.
    await import("zone.js");
    const [
      { WebTracerProvider, BatchSpanProcessor },
      { ZoneContextManager },
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { registerInstrumentations },
      { DocumentLoadInstrumentation },
      { FetchInstrumentation },
      { UserInteractionInstrumentation },
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-web"),
      import("@opentelemetry/context-zone"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
      import("@opentelemetry/instrumentation"),
      import("@opentelemetry/instrumentation-document-load"),
      import("@opentelemetry/instrumentation-fetch"),
      import("@opentelemetry/instrumentation-user-interaction"),
    ]);

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: BROWSER_SERVICE_NAME }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: config.endpoint, headers: config.headers }),
        ),
      ],
    });
    provider.register({ contextManager: new ZoneContextManager() });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        // Same-origin requests (/agent, /web) get a traceparent header by default,
        // which is exactly what links a browser span to the sidecar's SERVER span;
        // the cross-origin core (/v1) is intentionally NOT propagated. ignoreUrls
        // keeps the exporter's own POSTs to the collector from being traced.
        new FetchInstrumentation({ ignoreUrls: [config.endpoint] }),
        new UserInteractionInstrumentation(),
      ],
    });
  } catch {
    // best-effort: RUM must never break the app.
  }
}
