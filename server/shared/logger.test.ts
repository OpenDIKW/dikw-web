// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LoggerProvider, type ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createLogger } from "./logger.js";

let writeSpy: ReturnType<typeof vi.spyOn>;
let lines: string[];

beforeEach(() => {
  lines = [];
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  delete process.env.DIKW_LOG_FORMAT;
});

afterEach(() => {
  writeSpy.mockRestore();
  trace.disable();
  context.disable();
  logs.disable();
});

function lastJson(): Record<string, unknown> {
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

describe("createLogger", () => {
  it("writes exactly one JSON line per call with ts/level/scope/msg and flat fields", () => {
    const log = createLogger("test");
    log.info("hello", { a: 1, b: "x" });
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    const r = lastJson();
    expect(r).toMatchObject({ level: "info", scope: "test", msg: "hello", a: 1, b: "x" });
    expect(r.ts).toEqual(expect.any(String));
  });

  it("maps each level", () => {
    const log = createLogger("s");
    log.warn("w");
    expect(lastJson().level).toBe("warn");
    log.error("e");
    expect(lastJson().level).toBe("error");
  });

  it("redacts fields whose name looks sensitive, keeps the rest", () => {
    createLogger("s").info("connect", {
      mineruApiKey: "sk-secret",
      authToken: "bearer-xyz",
      password: "p",
      host: "127.0.0.1",
      enabled: true,
    });
    const r = lastJson();
    expect(r.mineruApiKey).toBe("[redacted]");
    expect(r.authToken).toBe("[redacted]");
    expect(r.password).toBe("[redacted]");
    expect(r.host).toBe("127.0.0.1");
    expect(r.enabled).toBe(true);
  });

  it("serializes an Error field value to name: message (no stack dump)", () => {
    createLogger("s").error("boom", { error: new TypeError("bad thing") });
    const r = lastJson();
    expect(r.error).toBe("TypeError: bad thing");
    expect(JSON.stringify(r)).not.toContain("at ");
  });

  it("omits trace ids with no active span and injects them within one", () => {
    const log = createLogger("s");
    log.info("no-span");
    expect(lastJson().trace_id).toBeUndefined();

    const provider = new NodeTracerProvider();
    provider.register();
    const span = trace.getTracer("t").startSpan("s");
    context.with(trace.setSpan(context.active(), span), () => {
      log.info("in-span");
    });
    span.end();
    const r = lastJson();
    expect(r.trace_id).toBe(span.spanContext().traceId);
    expect(r.span_id).toBe(span.spanContext().spanId);
  });

  it("emits a human text line (not JSON) under DIKW_LOG_FORMAT=text", () => {
    process.env.DIKW_LOG_FORMAT = "text";
    createLogger("test").warn("watch out", { code: "x" });
    const line = lines[lines.length - 1];
    expect(() => JSON.parse(line)).toThrow();
    expect(line).toContain("WARN");
    expect(line).toContain("[test]");
    expect(line).toContain("watch out");
    expect(line).toContain("code=x");
  });

  it("bridges to the OTel logs API with severity, scope attribute, redaction, and trace correlation", () => {
    const captured: ReadableLogRecord[] = [];
    const processor = {
      onEmit: (record: ReadableLogRecord) => captured.push(record),
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const loggerProvider = new LoggerProvider({ processors: [processor] });
    logs.setGlobalLoggerProvider(loggerProvider);

    const tracerProvider = new NodeTracerProvider();
    tracerProvider.register();
    const span = trace.getTracer("t").startSpan("s");
    context.with(trace.setSpan(context.active(), span), () => {
      createLogger("svc").error("db down", { attempt: 2, apiKey: "secret" });
    });
    span.end();

    expect(captured).toHaveLength(1);
    const rec = captured[0];
    expect(rec.body).toBe("db down");
    expect(rec.severityNumber).toBe(SeverityNumber.ERROR);
    expect(rec.attributes.scope).toBe("svc");
    expect(rec.attributes.attempt).toBe(2);
    expect(rec.attributes.apiKey).toBe("[redacted]");
    expect(rec.spanContext?.traceId).toBe(span.spanContext().traceId);
  });
});
