// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, propagation, SpanKind, trace } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { MiniMaxLlm } from "./minimaxLlm.js";
import { TranslatorClient } from "../web/translatorClient.js";

const INPUT = "private-request-content-fixture";
const OUTPUT = "private-response-content-fixture";
const API_KEY = "fixture-only-key";
const ENDPOINT_ENVS = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"];
const ENV_NAMES = [
  ...ENDPOINT_ENVS,
  "ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS",
  "ANTHROPIC_OPEN_TELEMETRY",
  "ANTHROPIC_OPEN_TELEMETRY_PROPAGATION",
  "ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE",
  "ANTHROPIC_OPEN_TELEMETRY_TRACES_MAX_CONTENT_BYTES",
] as const;

let server: Server;
let baseUrl: string;
let requests: Array<{
  traceparent: string | undefined;
  apiKey: string | undefined;
  authorization: string | undefined;
  apiVersion: string | undefined;
  body: string;
}>;
let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let disable: (() => void) | undefined;
let originalEnv: Array<string | undefined>;

function sseEvent(type: string, fields: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
}

function sseMessage(): string {
  return [
    sseEvent("message_start", {
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "fixture",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: OUTPUT } }),
    sseEvent("content_block_stop", { index: 0 }),
    sseEvent("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sseEvent("message_stop"),
  ].join("");
}

beforeEach(async () => {
  vi.resetModules();
  originalEnv = ENV_NAMES.map((name) => process.env[name]);
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS = "false";
  requests = [];
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      requests.push({
        traceparent: req.headers.traceparent as string | undefined,
        apiKey: req.headers["x-api-key"] as string | undefined,
        authorization: req.headers.authorization,
        apiVersion: req.headers["anthropic-version"] as string | undefined,
        body,
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sseMessage());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  exporter = new InMemorySpanExporter();
  // The app registers an ADK tracer even without an OTLP endpoint for #trace.
  provider = new NodeTracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

afterEach(async () => {
  disable?.();
  disable = undefined;
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  ENV_NAMES.forEach((name, index) => {
    const value = originalEnv[index];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
});

async function callClient(name: "agent" | "translator"): Promise<void> {
  if (name === "agent") {
    const client = new MiniMaxLlm({ model: "fixture", apiKey: API_KEY, baseUrl });
    const responses = [];
    for await (const response of client.generateContentAsync(
      {
        contents: [{ role: "user", parts: [{ text: INPUT }] }],
        liveConnectConfig: {},
        toolsDict: {},
      },
      true,
    )) {
      responses.push(response);
    }
    expect(responses.at(-1)?.content?.parts?.[0]?.text).toBe(OUTPUT);
  } else {
    const client = new TranslatorClient({
      model: "fixture",
      apiKey: API_KEY,
      baseUrl,
      maxRetries: 0,
    });
    expect(await client.translate([INPUT], "en")).toEqual([OUTPUT]);
  }
}

describe.each(["agent", "translator"] as const)("%s Anthropic telemetry policy", (name) => {
  it.each(["off", "on", "content"] as const)(
    "preserves endpoint-gated metadata-only tracing: %s",
    async (mode) => {
      if (mode !== "off") process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = baseUrl;
      if (mode === "content") {
        process.env.ANTHROPIC_OPEN_TELEMETRY = "true";
        process.env.ANTHROPIC_OPEN_TELEMETRY_PROPAGATION = "true";
        process.env.ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE = "content";
      }
      const { registerOutboundInstrumentation } = await import("./instrumentation.js");
      disable = registerOutboundInstrumentation();
      await callClient(name);
      await provider.forceFlush();

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toContain(INPUT);
      expect(requests[0].apiKey).toBe(API_KEY);
      expect(requests[0].authorization).toBeUndefined();
      expect(requests[0].apiVersion).toBe("2023-06-01");
      const spans = exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.CLIENT);
      const recorded = JSON.stringify(
        spans.map((span) => ({ attributes: span.attributes, events: span.events })),
      );
      expect(recorded).not.toContain(INPUT);
      expect(recorded).not.toContain(OUTPUT);
      if (mode === "off") {
        expect(requests[0].traceparent).toBeUndefined();
        expect(spans).toHaveLength(0);
      } else {
        expect(requests[0].traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
        expect(spans).toHaveLength(1);
        expect(spans[0].instrumentationScope.name).toBe("@opentelemetry/instrumentation-undici");
        expect(spans[0].attributes["http.request.method"]).toBe("POST");
        expect(spans[0].attributes["http.response.status_code"]).toBe(200);
      }
    },
  );
});
