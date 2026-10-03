// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { DikwSpanProcessor } from "./dikwSpanProcessor";
import { SpanStore } from "./spanStore";

// Minimal fake matching the installed @opentelemetry/sdk-trace-base 2.8.x
// ReadableSpan shape: spanContext() returns trace/span ids, parent lives on
// parentSpanContext?.spanId, times are HrTime ([seconds, nanos]).
function fakeSpan(
  overrides: Partial<{
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    startTime: [number, number];
    duration: [number, number];
    statusCode: number;
    kind: SpanKind;
    attributes: Record<string, unknown>;
  }> = {},
): ReadableSpan {
  const {
    name = "call_llm",
    traceId = "t1",
    spanId = "span-1",
    parentSpanId = "parent-1",
    startTime = [1_717, 500_000_000], // 1_717_000.5 ms
    duration = [0, 900_000_000], // 900 ms
    statusCode = 1,
    kind = SpanKind.INTERNAL,
    attributes = {},
  } = overrides;
  return {
    name,
    kind,
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    parentSpanContext: parentSpanId ? ({ spanId: parentSpanId } as never) : undefined,
    startTime,
    duration,
    status: { code: statusCode as never },
    attributes: attributes as never,
  } as unknown as ReadableSpan;
}

describe("DikwSpanProcessor.onEnd", () => {
  it("extracts a flat SpanRow with ms conversion, status, ids, and tokens", () => {
    const store = new SpanStore();
    const processor = new DikwSpanProcessor(store);

    // Seed the parent (root invocation) so the child's extracted parentSpanId is
    // present in the served view and survives getSessionTraces' dangling-parent
    // normalization — keeping this a faithful parent-child extraction check.
    processor.onEnd(
      fakeSpan({
        name: "invocation",
        spanId: "parent-1",
        parentSpanId: null,
        attributes: {
          "gcp.vertex.agent.session_id": "s1",
          "gcp.vertex.agent.invocation_id": "inv-1",
        },
      }),
    );
    processor.onEnd(
      fakeSpan({
        attributes: {
          "gcp.vertex.agent.session_id": "s1",
          "gcp.vertex.agent.invocation_id": "inv-1",
          "gen_ai.request.model": "MiniMax-M3",
          "gen_ai.usage.input_tokens": 1_240,
          "gen_ai.usage.output_tokens": 58,
          tags: ["a", "b"],
        },
      }),
    );

    const view = store.getSessionTraces("s1");
    expect(view.invocations).toHaveLength(1);
    const span = view.invocations[0].spans.find((s) => s.spanId === "span-1")!;
    expect(span.spanId).toBe("span-1");
    expect(span.parentSpanId).toBe("parent-1");
    expect(span.name).toBe("call_llm");
    // 1717 s + 0.5 s → 1_717_500 ms.
    expect(span.startTimeMs).toBe(1_717_500);
    expect(span.durationMs).toBe(900);
    expect(span.status).toBe("ok");
    expect(span.tokensInput).toBe(1_240);
    expect(span.tokensOutput).toBe(58);
    expect(span.attributes["gen_ai.request.model"]).toBe("MiniMax-M3");
    // Array attribute coerced to a JSON string (nothing dropped).
    expect(span.attributes.tags).toBe('["a","b"]');
  });

  it("skips SERVER-kind spans so HTTP server spans stay out of the #trace store", () => {
    const store = new SpanStore();
    const processor = new DikwSpanProcessor(store);

    // A withServerSpan HTTP span shares the trace with the agent invocation but
    // is OTLP-only infrastructure — it must not pollute the agent waterfall.
    processor.onEnd(
      fakeSpan({
        name: "POST /agent/sessions/:id/messages",
        kind: SpanKind.SERVER,
        spanId: "http-span",
        parentSpanId: null,
        attributes: {
          "gcp.vertex.agent.session_id": "s1",
          "http.route": "/agent/sessions/:id/messages",
        },
      }),
    );
    // An ordinary INTERNAL agent span on the same session is still recorded.
    processor.onEnd(
      fakeSpan({
        name: "call_llm",
        spanId: "llm-span",
        attributes: { "gcp.vertex.agent.session_id": "s1" },
      }),
    );

    const view = store.getSessionTraces("s1");
    const spanIds = view.invocations.flatMap((invocation) =>
      invocation.spans.map((span) => span.spanId),
    );
    expect(spanIds).toContain("llm-span");
    expect(spanIds).not.toContain("http-span");
  });

  it("skips CLIENT-kind spans so outbound HTTP (instrumentation-undici) stays out of the store", () => {
    const store = new SpanStore();
    const processor = new DikwSpanProcessor(store);

    // An outbound CLIENT span (a core /v1 or MinerU fetch) shares the agent trace
    // but is HTTP plumbing — it must not pollute the agent-only #trace waterfall.
    processor.onEnd(
      fakeSpan({
        name: "GET",
        kind: SpanKind.CLIENT,
        spanId: "client-span",
        attributes: {
          "gcp.vertex.agent.session_id": "s1",
          "http.request.method": "GET",
          "server.address": "127.0.0.1",
        },
      }),
    );
    processor.onEnd(
      fakeSpan({
        name: "call_llm",
        spanId: "llm-span",
        attributes: { "gcp.vertex.agent.session_id": "s1" },
      }),
    );

    const spanIds = store
      .getSessionTraces("s1")
      .invocations.flatMap((invocation) => invocation.spans.map((span) => span.spanId));
    expect(spanIds).toContain("llm-span");
    expect(spanIds).not.toContain("client-span");
  });

  it("maps status codes and falls back to gen_ai.conversation.id for sessionId, null parent", () => {
    const store = new SpanStore();
    const processor = new DikwSpanProcessor(store);

    processor.onEnd(
      fakeSpan({
        spanId: "root",
        parentSpanId: null,
        statusCode: 2,
        attributes: { "gen_ai.conversation.id": "s9" },
      }),
    );

    const view = store.getSessionTraces("s9");
    const span = view.invocations[0].spans[0];
    expect(span.parentSpanId).toBeNull();
    expect(span.status).toBe("error");
    expect(span.tokensInput).toBeUndefined();
    expect(span.tokensOutput).toBeUndefined();
  });

  it("drops sensitive content attributes while keeping safe ones and extracting sessionId/tokens", () => {
    const store = new SpanStore();
    const processor = new DikwSpanProcessor(store);

    processor.onEnd(
      fakeSpan({
        attributes: {
          "gcp.vertex.agent.llm_request": "{full convo + system prompt}",
          "gcp.vertex.agent.tool_response": "raw page body",
          "gcp.vertex.agent.session_id": "s1",
          "gen_ai.request.model": "MiniMax-M3",
          "gen_ai.usage.input_tokens": 1_240,
        },
      }),
    );

    // sessionId was extracted from the (un-redacted) session_id attr: the
    // span is reachable under "s1" at all.
    const view = store.getSessionTraces("s1");
    expect(view.invocations).toHaveLength(1);
    const span = view.invocations[0].spans[0];
    expect(span.attributes["gcp.vertex.agent.llm_request"]).toBeUndefined();
    expect(span.attributes["gcp.vertex.agent.tool_response"]).toBeUndefined();
    expect(span.attributes["gen_ai.request.model"]).toBe("MiniMax-M3");
    expect(span.attributes["gcp.vertex.agent.session_id"]).toBe("s1");
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(1_240);
    expect(span.tokensInput).toBe(1_240);
  });

  it('maps an unset status code to "unset"', () => {
    const store = new SpanStore();
    new DikwSpanProcessor(store).onEnd(
      fakeSpan({ statusCode: 0, attributes: { "gcp.vertex.agent.session_id": "s1" } }),
    );
    expect(store.getSessionTraces("s1").invocations[0].spans[0].status).toBe("unset");
  });
});
