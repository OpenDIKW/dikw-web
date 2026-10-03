// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SpanStore, type SpanRow } from "./spanStore";

const T0 = 1_717_488_000_000;

function row(overrides: Partial<SpanRow> & Pick<SpanRow, "spanId" | "name">): SpanRow {
  return {
    traceId: "t1",
    parentSpanId: null,
    startTimeMs: T0,
    durationMs: 100,
    status: "ok",
    attributes: {},
    sessionId: "s1",
    invocationId: "inv-1",
    ...overrides,
  };
}

describe("SpanStore.getSessionTraces", () => {
  function seedArchitectureTrace(store: SpanStore) {
    // Root invocation span carries NO session id (matches real ADK).
    store.record(
      row({
        spanId: "root",
        name: "invocation",
        sessionId: null,
        invocationId: null,
        startTimeMs: T0,
        durationMs: 4_200,
      }),
    );
    store.record(
      row({
        spanId: "agent",
        parentSpanId: "root",
        name: "invoke_agent dikw_agent",
        startTimeMs: T0 + 5,
        durationMs: 4_185,
        attributes: { "gen_ai.conversation.id": "s1" },
      }),
    );
    store.record(
      row({
        spanId: "llm",
        parentSpanId: "agent",
        name: "call_llm",
        startTimeMs: T0 + 20,
        durationMs: 900,
        attributes: { "gen_ai.request.model": "MiniMax-M3" },
        tokensInput: 1_240,
        tokensOutput: 58,
      }),
    );
    store.record(
      row({
        spanId: "tool",
        parentSpanId: "agent",
        name: "execute_tool retrieve_knowledge",
        startTimeMs: T0 + 940,
        durationMs: 1_500,
      }),
    );
  }

  it("re-attaches the root span via traceId and groups all four spans under one invocation", () => {
    const store = new SpanStore();
    seedArchitectureTrace(store);

    const view = store.getSessionTraces("s1");
    expect(view.sessionId).toBe("s1");
    expect(view.invocations).toHaveLength(1);

    const inv = view.invocations[0];
    expect(inv.invocationId).toBe("inv-1");
    // All 4 spans, including the root that has sessionId null + invocationId null.
    expect(inv.spans.map((span) => span.spanId)).toEqual(["root", "agent", "llm", "tool"]);
    // Sorted by startTimeMs.
    expect(inv.spans.map((span) => span.startTimeMs)).toEqual([T0, T0 + 5, T0 + 20, T0 + 940]);
    // durationMs = (max end) - (min start). The root span ends latest:
    // (T0 + 4200) - T0 = 4200.
    expect(inv.startTimeMs).toBe(T0);
    expect(inv.durationMs).toBe(4_200);

    const llm = inv.spans.find((span) => span.spanId === "llm")!;
    expect(llm.tokensInput).toBe(1_240);
    expect(llm.tokensOutput).toBe(58);
    expect(llm.attributes["gen_ai.request.model"]).toBe("MiniMax-M3");
  });

  it("isolates a second session's spans", () => {
    const store = new SpanStore();
    seedArchitectureTrace(store);
    store.record(
      row({
        spanId: "s2-root",
        traceId: "t2",
        name: "invocation",
        sessionId: null,
        invocationId: null,
      }),
    );
    store.record(
      row({
        spanId: "s2-llm",
        traceId: "t2",
        name: "call_llm",
        sessionId: "s2",
        invocationId: "inv-2",
      }),
    );

    const s1 = store.getSessionTraces("s1");
    expect(s1.invocations).toHaveLength(1);
    expect(s1.invocations[0].spans.every((span) => span.spanId.startsWith("s2-") === false)).toBe(
      true,
    );

    const s2 = store.getSessionTraces("s2");
    expect(s2.invocations).toHaveLength(1);
    // s2 root (traceId t2, sessionId null) re-attached + the s2 call_llm.
    expect(s2.invocations[0].spans.map((span) => span.spanId).sort()).toEqual([
      "s2-llm",
      "s2-root",
    ]);
  });

  it("returns no invocations for an unknown session", () => {
    const store = new SpanStore();
    seedArchitectureTrace(store);
    expect(store.getSessionTraces("nope")).toEqual({ sessionId: "nope", invocations: [] });
  });

  it("normalizes a parent that points to a span absent from the view to null", () => {
    // With the inbound SERVER span (Phase 2), ADK's root `invocation` span is
    // created inside the server span's context, so it carries the SERVER span's
    // id as its parent. DikwSpanProcessor filters SERVER spans out of the store,
    // so that parent id is never present here. The view must report the root as a
    // true root (parentSpanId null) — not a dangling reference — to honor the
    // TraceSpanView contract and keep the waterfall depth correct.
    const store = new SpanStore();
    store.record(
      row({
        spanId: "root",
        parentSpanId: "server-span-1", // filtered SERVER span, never recorded
        name: "invocation",
        sessionId: null,
        invocationId: null,
        durationMs: 1_000,
      }),
    );
    store.record(
      row({
        spanId: "llm",
        parentSpanId: "root",
        name: "call_llm",
        attributes: { "gen_ai.conversation.id": "s1" },
      }),
    );

    const view = store.getSessionTraces("s1");
    const spans = view.invocations[0].spans;
    const rootSpan = spans.find((span) => span.spanId === "root")!;
    const llmSpan = spans.find((span) => span.spanId === "llm")!;
    // Dangling SERVER parent → null (root).
    expect(rootSpan.parentSpanId).toBeNull();
    // A genuine in-invocation parent is preserved.
    expect(llmSpan.parentSpanId).toBe("root");
  });
});
