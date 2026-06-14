// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redactBrowserUrl } from "./initBrowserOtel";

// The OTel web SDK is pulled in via dynamic import() inside initBrowserOtel; mock
// every module so the test asserts the init wiring without loading the real SDK.
// vi.hoisted keeps the mock fns reachable from the hoisted vi.mock factories.
const mocks = vi.hoisted(() => {
  const register = vi.fn();
  return {
    register,
    // Regular function (not arrow) so `new WebTracerProvider()` returns this
    // object as the instance — an arrow's returned object is dropped by `new`.
    WebTracerProvider: vi.fn(function () {
      return { register };
    }),
    BatchSpanProcessor: vi.fn(),
    OTLPTraceExporter: vi.fn(),
    resourceFromAttributes: vi.fn((attrs: unknown) => ({ attrs })),
    registerInstrumentations: vi.fn(),
    DocumentLoadInstrumentation: vi.fn(),
    FetchInstrumentation: vi.fn(),
  };
});

vi.mock("@opentelemetry/sdk-trace-web", () => ({
  WebTracerProvider: mocks.WebTracerProvider,
  BatchSpanProcessor: mocks.BatchSpanProcessor,
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: mocks.OTLPTraceExporter,
}));
vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: mocks.resourceFromAttributes,
}));
vi.mock("@opentelemetry/semantic-conventions", () => ({ ATTR_SERVICE_NAME: "service.name" }));
vi.mock("@opentelemetry/instrumentation", () => ({
  registerInstrumentations: mocks.registerInstrumentations,
}));
vi.mock("@opentelemetry/instrumentation-document-load", () => ({
  DocumentLoadInstrumentation: mocks.DocumentLoadInstrumentation,
}));
vi.mock("@opentelemetry/instrumentation-fetch", () => ({
  FetchInstrumentation: mocks.FetchInstrumentation,
}));

// initBrowserOtel guards on module-level `initialized`; reset the module registry
// before each test so every case starts from a clean, un-initialized state.
async function freshInit(): Promise<(typeof import("./initBrowserOtel"))["initBrowserOtel"]> {
  vi.resetModules();
  const mod = await import("./initBrowserOtel");
  return mod.initBrowserOtel;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initBrowserOtel", () => {
  it("does nothing when telemetry is not configured", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel(null);
    expect(mocks.WebTracerProvider).not.toHaveBeenCalled();
    expect(mocks.registerInstrumentations).not.toHaveBeenCalled();
  });

  it("initializes a WebTracerProvider with the dikw-web-browser resource", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel({ endpoint: "https://c.example/v1/traces", headers: { "x-key": "v" } });

    expect(mocks.resourceFromAttributes).toHaveBeenCalledWith({
      "service.name": "dikw-web-browser",
    });
    expect(mocks.OTLPTraceExporter).toHaveBeenCalledWith({
      url: "https://c.example/v1/traces",
      headers: { "x-key": "v" },
    });
    expect(mocks.WebTracerProvider).toHaveBeenCalledTimes(1);
    // Registered with the default (StackContextManager) — no contextManager arg.
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register.mock.calls[0]).toHaveLength(0);
  });

  it("registers document-load and fetch instrumentations only", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel({ endpoint: "https://c/v1/traces" });

    expect(mocks.registerInstrumentations).toHaveBeenCalledTimes(1);
    const arg = mocks.registerInstrumentations.mock.calls[0][0] as { instrumentations: unknown[] };
    expect(arg.instrumentations).toHaveLength(2);
    expect(mocks.DocumentLoadInstrumentation).toHaveBeenCalledTimes(1);
    // The fetch instrumentation must ignore the exporter's own collector POSTs so
    // span export is never traced recursively.
    expect(mocks.FetchInstrumentation).toHaveBeenCalledWith(
      expect.objectContaining({ ignoreUrls: ["https://c/v1/traces"] }),
    );
  });

  it("registers a redacting onEnding processor that strips URLs before export", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel({ endpoint: "https://c/v1/traces" });

    const config = (mocks.WebTracerProvider.mock.calls[0] as unknown[])[0] as {
      spanProcessors: Array<{ onEnding?: (span: unknown) => void }>;
    };
    // The redacting processor plus the (mocked) BatchSpanProcessor.
    expect(config.spanProcessors).toHaveLength(2);
    const redactor = config.spanProcessors.find((p) => typeof p.onEnding === "function");
    expect(redactor).toBeDefined();

    const setAttribute = vi.fn();
    redactor!.onEnding!({
      attributes: {
        "url.full": "http://app/web/mineru/convert?originalFilename=secret.pdf&inputSha=ab",
      },
      setAttribute,
    });
    expect(setAttribute).toHaveBeenCalledWith("url.full", "http://app/web/mineru/convert");
  });

  it("passes headers: undefined to the exporter when none are configured", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel({ endpoint: "https://c/v1/traces" });
    expect(mocks.OTLPTraceExporter).toHaveBeenCalledWith({
      url: "https://c/v1/traces",
      headers: undefined,
    });
  });

  it("is idempotent: a second call does not re-initialize", async () => {
    const initBrowserOtel = await freshInit();
    await initBrowserOtel({ endpoint: "https://c/v1/traces" });
    await initBrowserOtel({ endpoint: "https://c/v1/traces" });
    expect(mocks.WebTracerProvider).toHaveBeenCalledTimes(1);
  });

  it("never throws if SDK initialization fails", async () => {
    mocks.WebTracerProvider.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const initBrowserOtel = await freshInit();
    await expect(initBrowserOtel({ endpoint: "https://c/v1/traces" })).resolves.toBeUndefined();
  });
});

describe("redactBrowserUrl", () => {
  it("drops the query string (user-derived filename, inputSha, tokens)", () => {
    expect(
      redactBrowserUrl(
        "http://app/web/mineru/convert?originalFilename=My%20Paper.pdf&inputSha=abc",
      ),
    ).toBe("http://app/web/mineru/convert");
  });

  it("templates session/job ids on /agent and /web (matching serverRoute)", () => {
    expect(redactBrowserUrl("http://app/agent/sessions/sess-123/messages")).toBe(
      "http://app/agent/sessions/:id/messages",
    );
    expect(redactBrowserUrl("http://app/web/mineru/jobs/9f9b/result")).toBe(
      "http://app/web/mineru/jobs/:id/result",
    );
  });

  it("templates core /v1 page / asset / task ids", () => {
    expect(redactBrowserUrl("http://app/v1/base/pages/some-doc/links")).toBe(
      "http://app/v1/base/pages/:id/links",
    );
    expect(redactBrowserUrl("http://app/v1/assets/sha256abc")).toBe("http://app/v1/assets/:id");
    expect(redactBrowserUrl("http://app/v1/tasks/42/events")).toBe(
      "http://app/v1/tasks/:id/events",
    );
  });

  it("leaves static paths unchanged", () => {
    expect(redactBrowserUrl("http://app/v1/base/graph")).toBe("http://app/v1/base/graph");
  });

  it("strips the query in the parse-failure (relative URL) fallback", () => {
    expect(redactBrowserUrl("/web/mineru/convert?originalFilename=x")).toBe("/web/mineru/convert");
  });
});
