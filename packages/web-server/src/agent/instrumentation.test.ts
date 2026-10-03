// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, SpanKind, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { Agent } from "undici";

const ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT";
// registerOutboundInstrumentation enables on EITHER var, so both must be cleared
// or a CI env that sets the traces-specific one would defeat the gate-off test.
const ENDPOINT_ENVS = [ENDPOINT_ENV, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] as const;

let server: Server;
let baseUrl: string;
let seenTraceparent: string | undefined;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let disable: (() => void) | undefined;
const originalEndpoints = ENDPOINT_ENVS.map((name) => process.env[name]);

beforeEach(async () => {
  vi.resetModules();
  for (const name of ENDPOINT_ENVS) {
    delete process.env[name];
  }
  seenTraceparent = undefined;
  server = createServer((req, res) => {
    seenTraceparent = req.headers.traceparent as string | undefined;
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterEach(async () => {
  disable?.();
  disable = undefined;
  await provider.shutdown();
  trace.disable();
  context.disable();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  ENDPOINT_ENVS.forEach((name, i) => {
    const original = originalEndpoints[i];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  });
});

function clientSpans() {
  return exporter.getFinishedSpans().filter((s) => s.kind === SpanKind.CLIENT);
}

describe("registerOutboundInstrumentation", () => {
  it("does not patch (no CLIENT span) when no OTLP traces endpoint is configured", async () => {
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();
    expect(disable).toBeUndefined();

    const res = await fetch(baseUrl);
    await res.text();
    expect(clientSpans()).toHaveLength(0);
  });

  it("emits a CLIENT span for an outbound fetch when an endpoint is configured", async () => {
    process.env[ENDPOINT_ENV] = "http://localhost:4318";
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();
    expect(disable).toBeTypeOf("function");

    const res = await fetch(`${baseUrl}/v1/health`);
    await res.text();

    const spans = clientSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes["http.request.method"]).toBe("GET");
    expect(spans[0].attributes["server.address"]).toBe("127.0.0.1");
    expect(spans[0].attributes["http.response.status_code"]).toBe(200);
  });

  it("redacts the query string so presigned-URL credentials never reach the span", async () => {
    process.env[ENDPOINT_ENV] = "http://localhost:4318";
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();

    const res = await fetch(`${baseUrl}/upload?X-Amz-Signature=topsecret&token=abc123`);
    await res.text();

    const span = clientSpans()[0];
    expect(span).toBeDefined();
    expect(String(span.attributes["url.full"])).toBe(`${baseUrl}/upload`);
    expect(String(span.attributes["url.full"])).not.toContain("topsecret");
    expect(span.attributes["url.query"]).toBe("[REDACTED]");
    // url.path is operationally useful and credential-free — kept.
    expect(span.attributes["url.path"]).toBe("/upload");
  });

  it("injects an outbound W3C traceparent that continues the active trace", async () => {
    process.env[ENDPOINT_ENV] = "http://localhost:4318";
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();

    const parent = trace.getTracer("test").startSpan("caller");
    const traceId = parent.spanContext().traceId;
    await context.with(trace.setSpan(context.active(), parent), async () => {
      const res = await fetch(baseUrl);
      await res.text();
    });
    parent.end();

    expect(seenTraceparent).toBeDefined();
    expect(seenTraceparent).toContain(traceId);
  });

  it("is orthogonal to the dispatcher choice: enabling it does not change a custom-dispatcher fetch outcome", async () => {
    // tools.ts passes a per-call `dispatcher: new ProxyAgent(...)` from the npm
    // `undici@8` package to Node's built-in `fetch`. That combination throws
    // `invalid onRequestStart method` (npm undici@8's handler interface vs Node's
    // bundled undici) REGARDLESS of this instrumentation — a pre-existing
    // version mismatch, orthogonal to OTel. We assert the instrumentation observes
    // via diagnostics_channel and does not change that outcome (does not "break"
    // a path that already fails, and never throws for the default-dispatcher path).
    async function fetchWithNpmDispatcher(): Promise<{ ok: boolean }> {
      const dispatcher = new Agent();
      try {
        const res = await fetch(baseUrl, { dispatcher } as RequestInit);
        await res.text();
        return { ok: true };
      } catch {
        return { ok: false };
      } finally {
        await dispatcher.close();
      }
    }

    const before = await fetchWithNpmDispatcher();
    process.env[ENDPOINT_ENV] = "http://localhost:4318";
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();
    const after = await fetchWithNpmDispatcher();

    // Same outcome with and without the patch → the instrumentation is orthogonal.
    expect(after.ok).toBe(before.ok);
    // The default-dispatcher path (what core/mineru/translator actually use) works
    // and spans under the patch.
    const res = await fetch(baseUrl);
    await res.text();
    expect(clientSpans().length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent: a second register call does not double-patch", async () => {
    process.env[ENDPOINT_ENV] = "http://localhost:4318";
    const { registerOutboundInstrumentation } = await import("./instrumentation.js");
    disable = registerOutboundInstrumentation();
    const second = registerOutboundInstrumentation();
    expect(second).toBeUndefined();

    const res = await fetch(baseUrl);
    await res.text();
    expect(clientSpans()).toHaveLength(1);
  });
});
