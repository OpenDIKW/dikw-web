import type { IncomingHttpHeaders } from "node:http";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { recordHttpServerDuration } from "./metrics.js";

const TRACER_NAME = "dikw-web";

/**
 * Collapses high-cardinality path segments to a low-cardinality route template
 * so span names / `http.route` don't explode per session or job id. The only
 * variable segments in the sidecar's routes are the one after `sessions`/`jobs`
 * (a session/job id) and the one after `proposals` (a proposal id). A trailing
 * slash is normalized away so dev (Connect-stripped) and prod produce the same
 * route for the bare `/agent` / `/web` mount.
 */
export function serverRoute(pathname: string): string {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const segments = normalized.split("/");
  return segments
    .map((segment, i) => {
      const prev = segments[i - 1];
      if (prev === "sessions" || prev === "jobs") {
        return ":id";
      }
      if (prev === "proposals") {
        return ":proposalId";
      }
      return segment;
    })
    .join("/");
}

interface ResLike {
  statusCode: number;
  on(event: string, listener: () => void): unknown;
}

interface ServerSpanParams {
  method: string;
  /**
   * Full request path including the `/agent` or `/web` prefix. Used only to
   * derive the low-cardinality `http.route`; the raw path (with session/job ids)
   * is deliberately NOT exported as `url.path`, matching the sidecar's
   * privacy-minimizing telemetry posture.
   */
  pathname: string;
  headers: IncomingHttpHeaders;
  res: ResLike;
}

/**
 * Wraps a sidecar request handler in an OTel SERVER span: extracts inbound W3C
 * trace context (so a browser → sidecar trace stitches through), runs the
 * handler inside that span's context (ADK / outbound spans nest under it), and
 * ends the span on response `finish`/`close` with the http.* status. Works as a
 * no-op when no tracer provider is registered.
 *
 * SERVER spans are exported via OTLP but kept out of the in-memory `#trace`
 * store — `DikwSpanProcessor` skips `SpanKind.SERVER` (the waterfall shows agent
 * work, not HTTP infrastructure).
 */
export async function withServerSpan(
  params: ServerSpanParams,
  run: () => void | Promise<void>,
): Promise<void> {
  const { method, pathname, headers, res } = params;
  const route = serverRoute(pathname);
  const tracer = trace.getTracer(TRACER_NAME);
  const parentCtx = propagation.extract(context.active(), headers);
  const span = tracer.startSpan(
    `${method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_HTTP_ROUTE]: route,
      },
    },
    parentCtx,
  );
  const startedAt = Date.now();

  let ended = false;
  let errored = false;
  const end = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, res.statusCode);
    if (!errored && res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
    recordHttpServerDuration((Date.now() - startedAt) / 1000, {
      method,
      route,
      statusCode: res.statusCode,
    });
  };
  res.on("finish", end);
  res.on("close", end);

  try {
    await context.with(trace.setSpan(parentCtx, span), run);
  } catch (error) {
    errored = true;
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
