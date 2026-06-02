// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { MiniMaxLlm, type AnthropicLike } from "./minimaxLlm";

interface FakeStreamEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

interface FakeFinalMessage {
  content: Array<Record<string, unknown>>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string | null;
}

interface CapturedCall {
  params: unknown;
  options?: { signal?: AbortSignal };
}

function makeFakeClient(opts: {
  events: FakeStreamEvent[];
  final: FakeFinalMessage;
  captured: CapturedCall[];
  throwOnAbort?: boolean;
}): AnthropicLike {
  return {
    messages: {
      stream(params, options) {
        opts.captured.push({ params, options });
        const signal = options?.signal;
        async function* iterate() {
          if (signal?.aborted && opts.throwOnAbort) {
            throw new Error("aborted");
          }
          for (const event of opts.events) {
            yield event;
          }
        }
        const iterable = iterate();
        return Object.assign(iterable, {
          async finalMessage() {
            return opts.final as never;
          }
        }) as never;
      }
    }
  };
}

async function drain(gen: AsyncGenerator<LlmResponse, void>): Promise<LlmResponse[]> {
  const out: LlmResponse[] = [];
  for await (const item of gen) {
    out.push(item);
  }
  return out;
}

const canned = {
  events: [
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
    // thinking_delta must NOT produce a partial response
    { type: "content_block_delta", delta: { type: "thinking_delta", text: "(reasoning)" } }
  ] satisfies FakeStreamEvent[],
  final: {
    content: [
      { type: "thinking", thinking: "ignored" },
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } }
    ],
    usage: { input_tokens: 12, output_tokens: 7 },
    stop_reason: "tool_use"
  } satisfies FakeFinalMessage
};

describe("MiniMaxLlm", () => {
  it("yields incremental text partials then one non-partial with text + functionCall + usage", async () => {
    const captured: CapturedCall[] = [];
    const llm = new MiniMaxLlm({
      model: "MiniMax-M3",
      apiKey: "x",
      baseUrl: "https://example/anthropic",
      client: makeFakeClient({ events: canned.events, final: canned.final, captured })
    });

    const request: LlmRequest = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      liveConnectConfig: {},
      toolsDict: {}
    };

    const responses = await drain(llm.generateContentAsync(request, true));

    // 2 partial text events, then 1 non-partial
    expect(responses).toHaveLength(3);
    expect(responses[0]).toMatchObject({ partial: true });
    expect(responses[0].content?.parts?.[0]?.text).toBe("Hel");
    expect(responses[1]).toMatchObject({ partial: true });
    expect(responses[1].content?.parts?.[0]?.text).toBe("lo");

    const finalResp = responses[2];
    expect(finalResp.partial).toBe(false);
    expect(finalResp.content?.role).toBe("model");
    const parts = finalResp.content?.parts ?? [];
    const textParts = parts.filter((p) => typeof p.text === "string").map((p) => p.text);
    expect(textParts).toEqual(["Hello"]);
    const fcPart = parts.find((p) => p.functionCall);
    expect(fcPart?.functionCall).toMatchObject({
      id: "call_1",
      name: "get_weather",
      args: { city: "Paris" }
    });
    expect(finalResp.usageMetadata).toMatchObject({
      promptTokenCount: 12,
      candidatesTokenCount: 7,
      totalTokenCount: 19
    });
    expect(finalResp.finishReason).toBe("STOP");
  });

  it("with stream:false emits NO partials, only the final non-partial response", async () => {
    const captured: CapturedCall[] = [];
    const llm = new MiniMaxLlm({
      model: "MiniMax-M3",
      apiKey: "x",
      baseUrl: "https://example/anthropic",
      client: makeFakeClient({ events: canned.events, final: canned.final, captured })
    });

    const request: LlmRequest = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      liveConnectConfig: {},
      toolsDict: {}
    };

    const responses = await drain(llm.generateContentAsync(request, false));

    // No partials — only the single final aggregated response.
    expect(responses).toHaveLength(1);
    expect(responses.some((r) => r.partial === true)).toBe(false);

    const finalResp = responses[0];
    expect(finalResp.partial).toBe(false);
    expect(finalResp.content?.role).toBe("model");
    const textParts = (finalResp.content?.parts ?? [])
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text);
    expect(textParts).toEqual(["Hello"]);
    expect(finalResp.usageMetadata).toMatchObject({
      promptTokenCount: 12,
      candidatesTokenCount: 7,
      totalTokenCount: 19
    });
  });

  it("translates the request: system string, role mapping, tool_result in user turn, merged same-role, lowercased schema", async () => {
    const captured: CapturedCall[] = [];
    const llm = new MiniMaxLlm({
      model: "MiniMax-M3",
      apiKey: "x",
      baseUrl: "https://example/anthropic",
      client: makeFakeClient({ events: [], final: { content: [], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }, captured })
    });

    const request: LlmRequest = {
      contents: [
        // two consecutive user turns -> must merge into one user message
        { role: "user", parts: [{ text: "first" }] },
        { role: "user", parts: [{ text: "second" }] },
        // model turn with a tool call -> assistant role
        { role: "model", parts: [{ functionCall: { id: "c1", name: "lookup", args: { q: "x" } } }] },
        // tool response -> must land in a USER turn as tool_result
        { role: "user", parts: [{ functionResponse: { id: "c1", name: "lookup", response: { answer: 42 } } }] }
      ],
      config: {
        systemInstruction: "You are helpful.",
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup",
                description: "Look something up",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    q: { type: "STRING", description: "query" },
                    tags: { type: "ARRAY", items: { type: "STRING" } }
                  },
                  required: ["q"]
                }
              }
            ]
          }
        ]
      } as never,
      liveConnectConfig: {},
      toolsDict: {}
    };

    await drain(llm.generateContentAsync(request, true));

    expect(captured).toHaveLength(1);
    const params = captured[0].params as {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
    };

    expect(params.model).toBe("MiniMax-M3");
    expect(params.system).toBe("You are helpful.");

    // merge: 1 user (first+second), 1 assistant (tool_use), 1 user (tool_result)
    expect(params.messages).toHaveLength(3);
    expect(params.messages[0].role).toBe("user");
    expect(params.messages[0].content).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" }
    ]);
    expect(params.messages[1].role).toBe("assistant");
    expect(params.messages[1].content[0]).toMatchObject({ type: "tool_use", id: "c1", name: "lookup", input: { q: "x" } });
    // tool_result forced into a user turn
    expect(params.messages[2].role).toBe("user");
    expect(params.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "c1",
      content: JSON.stringify({ answer: 42 })
    });

    // tool input_schema lowercased + recursive
    const schema = params.tools?.[0].input_schema as {
      type: string;
      properties: { q: { type: string; description: string }; tags: { type: string; items: { type: string } } };
      required: string[];
    };
    expect(params.tools?.[0].name).toBe("lookup");
    expect(schema.type).toBe("object");
    expect(schema.properties.q.type).toBe("string");
    expect(schema.properties.q.description).toBe("query");
    expect(schema.properties.tags.type).toBe("array");
    expect(schema.properties.tags.items.type).toBe("string");
    expect(schema.required).toEqual(["q"]);
  });

  it("propagates an already-aborted signal (does not swallow into a fake success)", async () => {
    const captured: CapturedCall[] = [];
    const llm = new MiniMaxLlm({
      model: "MiniMax-M3",
      apiKey: "x",
      baseUrl: "https://example/anthropic",
      client: makeFakeClient({
        events: canned.events,
        final: canned.final,
        captured,
        throwOnAbort: true
      })
    });

    const controller = new AbortController();
    controller.abort();

    const request: LlmRequest = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      liveConnectConfig: {},
      toolsDict: {}
    };

    await expect(drain(llm.generateContentAsync(request, true, controller.signal))).rejects.toThrow("aborted");
    // signal must have been forwarded to the transport
    expect(captured[0]?.options?.signal).toBe(controller.signal);
  });

  it("connect() throws (no live/bidi support)", async () => {
    const llm = new MiniMaxLlm({
      model: "MiniMax-M3",
      apiKey: "x",
      baseUrl: "https://example/anthropic",
      client: makeFakeClient({ events: [], final: { content: [], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "end_turn" }, captured: [] })
    });
    await expect(llm.connect()).rejects.toThrow(/live\/bidi connect/);
  });
});
