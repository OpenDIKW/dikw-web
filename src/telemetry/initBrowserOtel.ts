import type { TelemetryConfig } from "../config/telemetry";
// Type-only (erased at build, no bundle cost) — the runtime SDK is dynamic-imported.
import type { SpanProcessor } from "@opentelemetry/sdk-trace-web";

// service.name for browser RUM spans — kept distinct from the sidecar's
// "dikw-web" so frontend and backend signals are separable, while the W3C trace
// context still stitches a browser span to the sidecar's SERVER span.
const BROWSER_SERVICE_NAME = "dikw-web-browser";

let initialized = false;

// Path segments whose immediately-following segment is a high-cardinality or
// user-derived id: session/job/proposal ids on the sidecar's /agent + /web (these
// match server/shared/withServerSpan.ts's serverRoute) and page/asset/task ids on
// the core's /v1. The following segment is folded to ":id".
const ID_PARENT_SEGMENTS = new Set(["sessions", "jobs", "proposals", "pages", "assets", "tasks"]);

// URL-bearing fetch-span attributes (legacy + stable semconv) that the default
// FetchInstrumentation fills with the raw request URL.
const URL_ATTRS = ["url.full", "http.url"] as const;

/**
 * Redact a browser fetch URL before export: drop the query string entirely (it can
 * carry user-derived values — e.g. `/web/mineru/convert?originalFilename=…` — and
 * tokens) and template high-cardinality id path segments. This mirrors the sidecar's
 * privacy-minimizing SERVER-span posture (serverRoute templates the route and never
 * exports the raw path/query); the default FetchInstrumentation would otherwise
 * export the raw `url.full` / `http.url`.
 */
export function redactBrowserUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/");
    const path = segments
      .map((segment, i) => (ID_PARENT_SEGMENTS.has(segments[i - 1]) ? ":id" : segment))
      .join("/");
    return `${url.origin}${path}`;
  } catch {
    // Fetch hrefs are absolute so this shouldn't happen, but still strip the query
    // so nothing user-derived can leak through the fallback.
    return raw.split("?", 1)[0];
  }
}

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

    // Rewrites raw fetch-span URLs (query + id segments) before they are exported.
    // onEnding runs while the span is still writable and before BatchSpanProcessor
    // queues it, so setAttribute here is what ships — covering every fetch span
    // (success, error, abort) regardless of how it was invoked.
    const redactingProcessor: SpanProcessor = {
      onStart() {},
      onEnding(span) {
        for (const key of URL_ATTRS) {
          const value = span.attributes[key];
          if (typeof value === "string") {
            span.setAttribute(key, redactBrowserUrl(value));
          }
        }
      },
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: BROWSER_SERVICE_NAME }),
      spanProcessors: [
        redactingProcessor,
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
