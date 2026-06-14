// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { DikwSpanProcessor } from "../agent/dikwSpanProcessor.js";
import { SpanStore } from "../agent/spanStore.js";
import { serverRoute, withServerSpan } from "./withServerSpan.js";

let exporter: InMemorySpanExporter;
let store: SpanStore;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  store = new SpanStore();
  // Mirror prod: one global provider feeds BOTH the OTLP-side exporter and the
  // in-memory #trace store via DikwSpanProcessor.
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter), new DikwSpanProcessor(store)],
  });
  // register() installs the global provider + AsyncLocalStorage context manager
  // + W3C propagator, so context.with and propagation.extract behave as in prod.
  provider.register();
});

afterEach(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

function fakeRes(statusCode = 200): EventEmitter & { statusCode: number } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return res;
}

describe("serverRoute", () => {
  it("collapses session/job/proposal ids to low-cardinality templates", () => {
    expect(serverRoute("/agent/sessions/abc123/messages")).toBe("/agent/sessions/:id/messages");
    expect(serverRoute("/agent/sessions")).toBe("/agent/sessions");
    expect(serverRoute("/web/mineru/jobs/xyz/result")).toBe("/web/mineru/jobs/:id/result");
    expect(serverRoute("/agent/sessions/s1/proposals/p1/confirm")).toBe(
      "/agent/sessions/:id/proposals/:proposalId/confirm",
    );
    expect(serverRoute("/web/translate/health")).toBe("/web/translate/health");
  });

  it("normalizes a trailing slash so dev and prod agree on the bare mount", () => {
    // Prod sees "/agent/"; dev (Connect-stripped) rebuilds "/agent" — both must
    // template to the same route.
    expect(serverRoute("/agent/")).toBe("/agent");
    expect(serverRoute("/agent")).toBe("/agent");
    expect(serverRoute("/web/mineru/jobs/xyz/")).toBe("/web/mineru/jobs/:id");
  });
});

describe("withServerSpan", () => {
  it("records one SERVER span named method+route with http attrs, ending on finish", async () => {
    const res = fakeRes(200);
    await withServerSpan(
      { method: "POST", pathname: "/agent/sessions/s1/messages", headers: {}, res },
      () => {},
    );
    // Not ended until the response finishes.
    expect(exporter.getFinishedSpans()).toHaveLength(0);

    res.emit("finish");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("POST /agent/sessions/:id/messages");
    expect(spans[0].kind).toBe(SpanKind.SERVER);
    expect(spans[0].attributes["http.request.method"]).toBe("POST");
    expect(spans[0].attributes["http.route"]).toBe("/agent/sessions/:id/messages");
    // Raw path (with the session id) is deliberately NOT exported as url.path.
    expect(spans[0].attributes["url.path"]).toBeUndefined();
    expect(spans[0].attributes["http.response.status_code"]).toBe(200);
  });

  it("ends the span exactly once when both finish and close fire", async () => {
    const res = fakeRes(200);
    await withServerSpan(
      { method: "GET", pathname: "/agent/sessions", headers: {}, res },
      () => {},
    );
    res.emit("finish");
    res.emit("close");
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it("marks a 5xx response as error", async () => {
    const res = fakeRes(500);
    await withServerSpan(
      { method: "GET", pathname: "/web/mineru/health", headers: {}, res },
      () => {},
    );
    res.emit("finish");
    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it("records an exception and rethrows when the handler throws", async () => {
    const res = fakeRes(500);
    await expect(
      withServerSpan(
        { method: "POST", pathname: "/web/translate/submit", headers: {}, res },
        () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    res.emit("finish");
    const span = exporter.getFinishedSpans()[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((event) => event.name === "exception")).toBe(true);
  });

  it("continues an incoming W3C trace (browser → sidecar)", async () => {
    const res = fakeRes(200);
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    await withServerSpan(
      {
        method: "POST",
        pathname: "/agent/sessions/s1/messages",
        headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
        res,
      },
      () => {},
    );
    res.emit("finish");
    expect(exporter.getFinishedSpans()[0].spanContext().traceId).toBe(traceId);
  });

  it("nests work started inside run() under the server span", async () => {
    const res = fakeRes(200);
    let childTraceId = "";
    let activeSpanId = "";
    await withServerSpan(
      { method: "POST", pathname: "/agent/sessions/s1/messages", headers: {}, res },
      () => {
        const child = trace.getTracer("test").startSpan("child");
        childTraceId = child.spanContext().traceId;
        activeSpanId = trace.getActiveSpan()?.spanContext().spanId ?? "";
        child.end();
      },
    );
    res.emit("finish");
    const server = exporter.getFinishedSpans().find((span) => span.name.includes("messages"));
    expect(server).toBeDefined();
    expect(childTraceId).toBe(server!.spanContext().traceId);
    expect(activeSpanId).toBe(server!.spanContext().spanId);
  });

  it("exports the server span to OTLP but keeps it out of the #trace store", async () => {
    const res = fakeRes(200);
    await withServerSpan(
      { method: "POST", pathname: "/agent/sessions/s1/messages", headers: {}, res },
      () => {
        // Simulate ADK's INTERNAL agent spans created within the request.
        const invocation = trace.getTracer("adk").startSpan("invocation");
        context.with(trace.setSpan(context.active(), invocation), () => {
          trace
            .getTracer("adk")
            .startSpan("call_llm", {
              attributes: {
                "gcp.vertex.agent.session_id": "s1",
                "gcp.vertex.agent.invocation_id": "inv-1",
              },
            })
            .end();
        });
        invocation.end();
      },
    );
    res.emit("finish");

    // OTLP side: server + both agent spans, all on one trace.
    const exported = exporter.getFinishedSpans();
    const serverSpan = exported.find((span) => span.name.includes("messages"));
    expect(serverSpan).toBeDefined();
    expect(exported.map((span) => span.name).sort()).toEqual([
      "POST /agent/sessions/:id/messages",
      "call_llm",
      "invocation",
    ]);
    expect(
      exported.every((span) => span.spanContext().traceId === serverSpan!.spanContext().traceId),
    ).toBe(true);
    const invocation = exported.find((span) => span.name === "invocation");
    expect(invocation!.parentSpanContext?.spanId).toBe(serverSpan!.spanContext().spanId);

    // #trace side: only the agent spans, never the SERVER span.
    const storeSpans = store.getSessionTraces("s1").invocations.flatMap((inv) => inv.spans);
    const storeNames = storeSpans.map((span) => span.name);
    expect(storeNames).toContain("call_llm");
    expect(storeNames).not.toContain("POST /agent/sessions/:id/messages");
    // The `invocation` span was parented to the now-filtered SERVER span; the view
    // must normalize that dangling parent to null so it stays a true root.
    const storedInvocation = storeSpans.find((span) => span.name === "invocation")!;
    expect(storedInvocation.parentSpanId).toBeNull();
  });
});
