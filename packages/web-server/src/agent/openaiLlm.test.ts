// @vitest-environment node
import { expect, it } from "vitest";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { OpenAILlm, toOpenAIRequest } from "./openaiLlm.js";
import type { OpenAICompletionRequest } from "../runtime/requestModel.js";
const request = (value: Partial<LlmRequest> = {}): LlmRequest => ({
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  liveConnectConfig: {},
  toolsDict: {},
  ...value,
});
async function drain(stream: AsyncGenerator<LlmResponse, void>) {
  const out = [];
  for await (const response of stream) out.push(response);
  return out;
}
it("keeps system/tools/tool results and emits one UI delta plus one persisted final", async () => {
  const bodies: OpenAICompletionRequest[] = [];
  const llm = new OpenAILlm({
    transport: {
      model: "alice-profile",
      async complete(body) {
        bodies.push(body);
        return {
          choices: [
            {
              message: {
                content: "Result",
                reasoning_content: "HIDDEN_REASONING",
                tool_calls: [
                  {
                    id: "c2",
                    type: "function",
                    function: { name: "read_page", arguments: '{"path":"sources/a.md"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        };
      },
    },
  });
  const input = request({
    config: {
      systemInstruction: "system",
      tools: [
        {
          functionDeclarations: [
            {
              name: "read_page",
              parametersJsonSchema: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          ],
        },
      ],
    },
    contents: [
      { role: "user", parts: [{ text: "question" }] },
      {
        role: "model",
        parts: [{ functionCall: { id: "c1", name: "read_page", args: { path: "sources/a.md" } } }],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { id: "c1", name: "read_page", response: { body: "evidence" } } },
        ],
      },
    ],
  });
  const out = await drain(llm.generateContentAsync(input, true));
  expect(bodies[0]).toMatchObject({
    model: "alice-profile",
    stream: false,
    messages: [
      { role: "system", content: "system" },
      { role: "user" },
      { role: "assistant", tool_calls: [{ id: "c1" }] },
      { role: "tool", tool_call_id: "c1" },
    ],
    tools: [{ function: { parameters: { type: "object" } } }],
  });
  const next = toOpenAIRequest(
    request({
      contents: [
        out[1].content!,
        {
          role: "user",
          parts: [{ functionResponse: { id: "c2", name: "read_page", response: { ok: true } } }],
        },
      ],
    }),
    "alice-profile",
    8192,
  );
  expect(next.messages[0]).toMatchObject({
    role: "assistant",
    content: "Result",
    reasoning_content: "HIDDEN_REASONING",
  });
  expect(JSON.stringify(out[0])).not.toContain("HIDDEN_REASONING");
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ partial: true, content: { parts: [{ text: "Result" }] } });
  expect(out[1]).toMatchObject({
    partial: false,
    content: {
      parts: [
        { text: "HIDDEN_REASONING", thought: true },
        { text: "Result" },
        { functionCall: { id: "c2", name: "read_page", args: { path: "sources/a.md" } } },
      ],
    },
    usageMetadata: { totalTokenCount: 15 },
  });
});
it("non-streaming compaction emits only final and shares budget/cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const llm = new OpenAILlm({
    transport: {
      model: "m",
      async complete(_body, signal) {
        expect(signal).toBeDefined();
        calls++;
        return { choices: [{ message: { content: "summary" } }] };
      },
    },
    maxCalls: 2,
    abortSignal: controller.signal,
  });
  expect(await drain(llm.generateContentAsync(request(), false))).toHaveLength(1);
  expect(await drain(llm.generateContentAsync(request(), true))).toHaveLength(2);
  await expect(drain(llm.generateContentAsync(request(), true))).rejects.toThrow("budget");
  expect(calls).toBe(2);
  const blocked = new OpenAILlm({
    transport: {
      model: "m",
      async complete() {
        throw new Error("must not run");
      },
    },
    abortSignal: controller.signal,
  });
  controller.abort();
  await expect(drain(blocked.generateContentAsync(request(), true))).rejects.toThrow();
});
it("does not expose transport exception text or malformed tool arguments", async () => {
  const llm = new OpenAILlm({
    transport: {
      model: "m",
      async complete() {
        throw new Error("Bearer PRIVATE_FIXTURE");
      },
    },
  });
  await expect(drain(llm.generateContentAsync(request(), true))).rejects.toThrow(
    "Model service unavailable",
  );
  const malformed = new OpenAILlm({
    transport: {
      model: "m",
      async complete() {
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "c",
                    type: "function",
                    function: { name: "tool", arguments: "PRIVATE_FIXTURE" },
                  },
                ],
              },
            },
          ],
        };
      },
    },
  });
  await expect(drain(malformed.generateContentAsync(request(), true))).rejects.toThrow(
    "Model service unavailable",
  );
});
it("bounds output and carries genai schema conversion without image/file data", () => {
  const body = toOpenAIRequest(
    request({
      config: {
        maxOutputTokens: 50000,
        tools: [
          {
            functionDeclarations: [
              {
                name: "x",
                parameters: { type: "OBJECT", properties: { q: { type: "STRING" } } } as never,
              },
            ],
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "SECRET_IMAGE" } }],
        },
      ],
    }),
    "m",
    8192,
  );
  expect(body.max_tokens).toBe(8192);
  expect(JSON.stringify(body)).not.toContain("SECRET_IMAGE");
  expect(body.tools?.[0].function.parameters).toMatchObject({
    type: "object",
    properties: { q: { type: "string" } },
  });
});

it("preserves absent usage so ADK estimates token count for compaction", async () => {
  const llm = new OpenAILlm({
    transport: {
      model: "m",
      async complete() {
        return { choices: [{ message: { content: "long text fallback" } }] };
      },
    },
  });
  const responses = await drain(llm.generateContentAsync(request(), false));
  expect(responses[0].usageMetadata).toBeUndefined();
});
it.each([
  ["stop", true],
  ["length", true],
  ["stop", false],
  ["length", false],
] as const)("rejects reasoning-only output (%s, streaming=%s)", async (finishReason, stream) => {
  const llm = new OpenAILlm({
    transport: {
      model: "m",
      async complete() {
        return {
          choices: [
            {
              message: { content: null, reasoning_content: "PRIVATE_HIDDEN_REASONING" },
              finish_reason: finishReason,
            },
          ],
        };
      },
    },
  });
  const error = await drain(llm.generateContentAsync(request(), stream)).catch((value) => value);
  expect(error).toMatchObject({
    name: "ModelResolutionError",
    status: 502,
    message: "Model returned no visible answer; try again or choose another model.",
  });
  expect(String(error)).not.toContain("PRIVATE_HIDDEN_REASONING");
});
