// Runtime browser-RUM telemetry config, mirroring src/config/branding.ts. A
// `telemetry` block in public/config.json opts the browser into OpenTelemetry
// OTLP trace export; a missing, malformed, or endpoint-less block yields null, in
// which case the heavy OTel web SDK is never loaded (see src/telemetry/
// initBrowserOtel.ts). config.json is gitignored and per-deployment.

export interface TelemetryConfig {
  // Full OTLP/HTTP traces endpoint, e.g. https://collector.example.com/v1/traces.
  endpoint: string;
  // Optional auth/routing headers for the collector (e.g. Grafana Cloud token).
  headers?: Record<string, string>;
}

// Cap the startup config fetch so a stalled /config.json can never delay the
// (already best-effort, fire-and-forget) RUM init.
const TELEMETRY_FETCH_TIMEOUT_MS = 2000;

function resolveHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Merge an unknown, possibly-partial external config into a TelemetryConfig, or
// null when no usable endpoint is present.
export function resolveTelemetry(raw: unknown): TelemetryConfig | null {
  const telemetry =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).telemetry : undefined;
  if (!telemetry || typeof telemetry !== "object") {
    return null;
  }
  const obj = telemetry as Record<string, unknown>;
  const endpoint = typeof obj.endpoint === "string" ? obj.endpoint.trim() : "";
  if (!endpoint) {
    return null;
  }
  const headers = resolveHeaders(obj.headers);
  return headers ? { endpoint, headers } : { endpoint };
}

async function fetchTelemetry(): Promise<TelemetryConfig | null> {
  try {
    const res = await fetch("/config.json", { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return null;
    }
    return resolveTelemetry((await res.json()) as unknown);
  } catch {
    return null;
  }
}

// Fetch the runtime telemetry config once at startup. A missing, unreachable,
// malformed, or slow config.json resolves to null so RUM simply stays off and
// the app renders normally. Mirrors loadBranding(); the second same-origin GET of
// the tiny static config.json is served from the browser cache.
export function loadTelemetry(): Promise<TelemetryConfig | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TelemetryConfig | null>((resolve) => {
    timer = setTimeout(() => resolve(null), TELEMETRY_FETCH_TIMEOUT_MS);
  });
  return Promise.race([fetchTelemetry(), timeout]).finally(() => clearTimeout(timer));
}
