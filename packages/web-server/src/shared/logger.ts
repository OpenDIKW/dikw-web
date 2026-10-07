// Structured sidecar logger. Replaces ad-hoc console.* with one-line structured
// records: JSON to stdout (a human text line when stdout is a TTY or
// DIKW_LOG_FORMAT=text), the active span's trace_id/span_id injected for
// correlation, and — when a global LoggerProvider is registered — a mirrored OTel
// LogRecord. ADK's maybeSetOtelProviders builds that LoggerProvider (its own OTLP
// BatchLogRecordProcessor) when OTEL_EXPORTER_OTLP_ENDPOINT / *_LOGS_ENDPOINT is
// set, so logs ship to Loki/etc. alongside traces; with no endpoint env there is
// no provider and the bridge is a no-op (stdout is unchanged from a plain print).
//
// There is no arbitrary-object dump path: callers pass a flat field map, and field
// NAMES that look secret are redacted regardless of value, so a secret can never
// be logged by accident (callers also pass booleans/ids, never raw secrets). An
// Error value is reduced to its class name and a known system/transport code,
// never its message; any other object value is reduced to `[object]`.
// Nothing here touches dikw-core.

import { trace } from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSystemErrorMap } from "node:util";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LOGGER_NAME = "dikw-web";
export const applicationContext = new AsyncLocalStorage<string>();
// Field names that must never carry a value into a log line. Defense in depth on
// top of the discipline that callers log booleans/ids, never raw secrets.
const SENSITIVE_KEY = /key|token|auth|secret|password|credential/i;
const SEVERITY: Record<LogLevel, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export function createLogger(scope: string, appId?: string): Logger {
  const at =
    (level: LogLevel) =>
    (msg: string, fields?: LogFields): void =>
      appId
        ? applicationContext.run(appId, () => emit(level, scope, msg, fields))
        : emit(level, scope, msg, fields);
  return { info: at("info"), warn: at("warn"), error: at("error") };
}

function emit(level: LogLevel, scope: string, msg: string, fields?: LogFields): void {
  const safe = sanitize(fields);
  const spanContext = trace.getActiveSpan()?.spanContext();
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(applicationContext.getStore() ? { appId: applicationContext.getStore() } : {}),
    ...(spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {}),
    ...safe,
  };
  process.stdout.write(`${formatLine(record)}\n`);

  // OTel logs bridge — no-op until a global LoggerProvider is registered. The SDK
  // stamps trace_id/span_id onto the LogRecord from the active context, so the
  // attributes carry only scope + caller fields.
  logs.getLogger(applicationContext.getStore() ?? LOGGER_NAME).emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: msg,
    attributes: { scope, ...safe },
  });
}

function sanitize(fields?: LogFields): LogFields {
  if (!fields) {
    return {};
  }
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
    } else if (value instanceof Error) {
      out[key] = describeError(value);
    } else if (typeof value === "object" && value !== null) {
      // A thrown non-Error (an SDK error body, a rejection reason) is not dumped.
      out[key] = "[object]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Node-style `Class [CODE]`. Neither the message nor `name` is logged: both are
// set at runtime, and a provider or upstream error can echo a token, a client
// secret or a credential-bearing URL. A code is kept only when it is a fixed
// runtime constant — a libuv system error name, DNS `ENOTFOUND` or an undici
// transport code — so it cannot carry a secret.
const KNOWN_ERROR_CODES = new Set([
  ...[...getSystemErrorMap().values()].map(([name]) => name),
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function describeError(error: Error): string {
  // Node fetch rejects with `TypeError: fetch failed` and puts the reason on
  // `cause`. The walk is bounded because a cause chain can be cyclic.
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
    const { code } = cause as { code?: unknown };
    if (typeof code === "string" && KNOWN_ERROR_CODES.has(code)) {
      return `${error.constructor.name} [${code}]`;
    }
    cause = cause.cause;
  }
  return error.constructor.name;
}

function formatLine(record: Record<string, unknown>): string {
  if (!textMode()) {
    return JSON.stringify(record);
  }
  const { ts, level, scope, msg, ...rest } = record;
  const extra = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${ts} ${String(level).toUpperCase()} [${scope}] ${msg}${extra ? ` ${extra}` : ""}`;
}

function textMode(): boolean {
  const env = process.env.DIKW_LOG_FORMAT?.trim().toLowerCase();
  if (env === "text") {
    return true;
  }
  if (env === "json") {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}
