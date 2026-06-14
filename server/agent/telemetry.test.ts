// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ADK so the test never loads the heavy runtime (native sqlite3 etc.) and
// we can assert exactly how initAgentTelemetry wires the provider.
const { maybeSetOtelProviders } = vi.hoisted(() => ({
  maybeSetOtelProviders: vi.fn(),
}));
vi.mock("@google/adk", () => ({ maybeSetOtelProviders }));

const ORIGINAL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME;

beforeEach(() => {
  // telemetry.ts guards registration with a module-level flag; reset the module
  // graph so each test exercises a fresh init.
  vi.resetModules();
  maybeSetOtelProviders.mockClear();
  delete process.env.OTEL_SERVICE_NAME;
});

afterEach(() => {
  if (ORIGINAL_SERVICE_NAME === undefined) {
    delete process.env.OTEL_SERVICE_NAME;
  } else {
    process.env.OTEL_SERVICE_NAME = ORIGINAL_SERVICE_NAME;
  }
});

describe("buildDikwResource", () => {
  it("identifies the service as dikw-web with a version and a per-process instance id", async () => {
    const { buildDikwResource } = await import("./telemetryResource.js");
    const attrs = buildDikwResource().attributes;
    expect(attrs["service.name"]).toBe("dikw-web");
    expect(attrs["service.version"]).toEqual(expect.any(String));
    expect(String(attrs["service.version"]).length).toBeGreaterThan(0);
    expect(attrs["service.instance.id"]).toEqual(expect.any(String));
    expect(String(attrs["service.instance.id"]).length).toBeGreaterThan(0);
  });

  it("honors the standard OTEL_SERVICE_NAME override", async () => {
    process.env.OTEL_SERVICE_NAME = "dikw-web-staging";
    const { buildDikwResource } = await import("./telemetryResource.js");
    expect(buildDikwResource().attributes["service.name"]).toBe("dikw-web-staging");
  });

  it("falls back to dikw-web when OTEL_SERVICE_NAME is blank", async () => {
    process.env.OTEL_SERVICE_NAME = "   ";
    const { buildDikwResource } = await import("./telemetryResource.js");
    expect(buildDikwResource().attributes["service.name"]).toBe("dikw-web");
  });

  it("keeps service.instance.id stable across calls within a process", async () => {
    // service.instance.id identifies one running process — repeated builds (later
    // phases reuse the resource for metrics/logs) must report the SAME id, not a
    // fresh one per call, or signals from one sidecar split across instances.
    const { buildDikwResource } = await import("./telemetryResource.js");
    const a = buildDikwResource().attributes["service.instance.id"];
    const b = buildDikwResource().attributes["service.instance.id"];
    expect(a).toBe(b);
  });
});

describe("initAgentTelemetry", () => {
  it("registers the DikwSpanProcessor with the dikw-web resource", async () => {
    const { initAgentTelemetry } = await import("./telemetry.js");
    const { SpanStore } = await import("./spanStore.js");
    const { DikwSpanProcessor } = await import("./dikwSpanProcessor.js");

    initAgentTelemetry(new SpanStore());

    expect(maybeSetOtelProviders).toHaveBeenCalledTimes(1);
    const [hooks, resource] = maybeSetOtelProviders.mock.calls[0];
    expect(hooks[0].spanProcessors).toHaveLength(1);
    expect(hooks[0].spanProcessors[0]).toBeInstanceOf(DikwSpanProcessor);
    expect(resource.attributes["service.name"]).toBe("dikw-web");
  });

  it("is idempotent per process (registers providers only once)", async () => {
    const { initAgentTelemetry } = await import("./telemetry.js");
    const { SpanStore } = await import("./spanStore.js");
    const store = new SpanStore();

    initAgentTelemetry(store);
    initAgentTelemetry(store);
    initAgentTelemetry(store);

    expect(maybeSetOtelProviders).toHaveBeenCalledTimes(1);
  });

  it("keeps message content out of spans (privacy default)", async () => {
    const { initAgentTelemetry } = await import("./telemetry.js");
    const { SpanStore } = await import("./spanStore.js");

    initAgentTelemetry(new SpanStore());

    expect(process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS).toBe("false");
  });
});
