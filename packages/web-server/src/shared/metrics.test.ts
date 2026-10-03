// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  InMemoryMetricExporter,
  type MeterProvider as MeterProviderType,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

let exporter: InMemoryMetricExporter;
let provider: MeterProviderType;

beforeEach(() => {
  // Fresh module graph each test so metrics.ts re-binds its lazily-memoized
  // instruments to THIS test's provider (the cache otherwise outlives one test).
  vi.resetModules();
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  // A practically-infinite interval: we export on demand via forceFlush, never
  // on a timer.
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 2_147_483_647,
  });
  provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  // Reset the global meter provider so the next test starts from no-op.
  metrics.disable();
});

/** Flush the reader and flatten every exported metric across scopes. */
async function collect(): Promise<
  Array<{ name: string; unit: string; points: DataPoint<number | Histogram>[] }>
> {
  await provider.forceFlush();
  const batches: ResourceMetrics[] = exporter.getMetrics();
  const latest = batches[batches.length - 1];
  if (!latest) return [];
  return latest.scopeMetrics.flatMap((scope) =>
    scope.metrics.map((metric) => ({
      name: metric.descriptor.name,
      unit: metric.descriptor.unit,
      points: metric.dataPoints as DataPoint<number | Histogram>[],
    })),
  );
}

async function metric(name: string) {
  const all = await collect();
  return all.find((m) => m.name === name);
}

describe("dikw metrics", () => {
  it("records job duration + count by family/outcome and tracks inflight", async () => {
    const m = await import("./metrics.js");
    m.recordJobStart("mineru");
    m.recordJobStart("translate");
    m.recordJobEnd("mineru", "succeeded", 2.5);
    // translate stays inflight (never ended).

    const duration = await metric("dikw.job.duration");
    expect(duration?.unit).toBe("s");
    expect(duration?.points).toHaveLength(1);
    expect(duration?.points[0].attributes).toMatchObject({
      "dikw.job.family": "mineru",
      "dikw.job.outcome": "succeeded",
    });
    expect((duration?.points[0].value as Histogram).sum).toBeCloseTo(2.5);

    const count = await metric("dikw.job.count");
    expect(count?.points[0].value).toBe(1);
    expect(count?.points[0].attributes).toMatchObject({
      "dikw.job.family": "mineru",
      "dikw.job.outcome": "succeeded",
    });

    // inflight: +mineru +translate -mineru = net translate(1), mineru(0).
    const inflight = await metric("dikw.job.inflight");
    const byFamily = Object.fromEntries(
      (inflight?.points ?? []).map((p) => [p.attributes["dikw.job.family"], p.value]),
    );
    expect(byFamily).toMatchObject({ mineru: 0, translate: 1 });
  });

  it("records a failed job under the failed outcome", async () => {
    const m = await import("./metrics.js");
    m.recordJobStart("translate");
    m.recordJobEnd("translate", "failed", 0.4);

    const count = await metric("dikw.job.count");
    expect(count?.points[0].attributes).toMatchObject({
      "dikw.job.family": "translate",
      "dikw.job.outcome": "failed",
    });
    expect(count?.points[0].value).toBe(1);
  });

  it("records llm tokens by direction", async () => {
    const m = await import("./metrics.js");
    m.recordLlmTokens("input", 1_240);
    m.recordLlmTokens("output", 58);

    const tokens = await metric("dikw.llm.tokens");
    expect(tokens?.unit).toBe("{token}");
    const byDir = Object.fromEntries(
      (tokens?.points ?? []).map((p) => [p.attributes["gen_ai.token.type"], p.value]),
    );
    expect(byDir).toMatchObject({ input: 1_240, output: 58 });
  });

  it("records agent turn duration by outcome", async () => {
    const m = await import("./metrics.js");
    m.recordAgentTurnDuration(3.2, "ok");

    const turn = await metric("dikw.agent.turn.duration");
    expect(turn?.unit).toBe("s");
    expect(turn?.points[0].attributes).toMatchObject({ "dikw.agent.turn.outcome": "ok" });
    expect((turn?.points[0].value as Histogram).sum).toBeCloseTo(3.2);
  });

  it("is a no-op when no meter provider is set (no endpoint configured)", async () => {
    metrics.disable(); // simulate no global provider
    const m = await import("./metrics.js");
    // Must not throw; nothing to assert beyond "did not throw".
    expect(() => {
      m.recordJobEnd("mineru", "succeeded", 1);
      m.recordLlmTokens("input", 10);
      m.recordAgentTurnDuration(1, "error");
    }).not.toThrow();
  });

  it("integration: withServerSpan records http.server.request.duration with route+status", async () => {
    const { withServerSpan } = await import("./withServerSpan.js");
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = 200;
    await withServerSpan(
      { method: "POST", pathname: "/agent/sessions/abc/messages", headers: {}, res },
      () => {},
    );
    res.emit("finish");

    const http = await metric("http.server.request.duration");
    expect(http?.unit).toBe("s");
    expect(http?.points).toHaveLength(1);
    expect(http?.points[0].attributes).toMatchObject({
      "http.request.method": "POST",
      "http.route": "/agent/sessions/:id/messages",
      "http.response.status_code": 200,
    });
  });

  it("integration: DikwSpanProcessor records dikw.llm.tokens from a token-bearing span", async () => {
    const { DikwSpanProcessor } = await import("../agent/dikwSpanProcessor.js");
    const { SpanStore } = await import("../agent/spanStore.js");
    const processor = new DikwSpanProcessor(new SpanStore());
    processor.onEnd({
      name: "call_llm",
      kind: 0,
      spanContext: () => ({ traceId: "t1", spanId: "s1", traceFlags: 1 }),
      parentSpanContext: undefined,
      startTime: [1, 0],
      duration: [0, 1],
      status: { code: 1 },
      attributes: {
        "gcp.vertex.agent.session_id": "s1",
        "gen_ai.usage.input_tokens": 1_240,
        "gen_ai.usage.output_tokens": 58,
      },
    } as never);

    const tokens = await metric("dikw.llm.tokens");
    const byDir = Object.fromEntries(
      (tokens?.points ?? []).map((p) => [p.attributes["gen_ai.token.type"], p.value]),
    );
    expect(byDir).toMatchObject({ input: 1_240, output: 58 });
  });
});
