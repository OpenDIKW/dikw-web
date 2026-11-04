import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import type { Content, Part } from "@google/genai";
import { genaiSchemaToJsonSchema, systemInstructionToString } from "./minimaxLlm.js";
import {
  ModelResolutionError,
  safeModelError,
  type RequestModel,
  type OpenAICompletionRequest,
  type OpenAIMessage,
} from "../runtime/requestModel.js";

/** One stateless transport per turn, shared with ADK's compactor and tool loop. */
export class OpenAILlm extends BaseLlm {
  private calls = 0;
  constructor(
    private readonly options: {
      transport: RequestModel;
      abortSignal?: AbortSignal;
      maxCalls?: number;
      maxOutputTokens?: number;
    },
  ) {
    super({ model: options.transport.model });
  }
  async connect(): Promise<never> {
    throw new Error("OpenAILlm does not support live/bidi connect");
  }
  async *generateContentAsync(
    request: LlmRequest,
    stream?: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    if (this.calls >= (this.options.maxCalls ?? 8))
      throw new ModelResolutionError(
        429,
        "Turn model-call budget exhausted; narrow the question and try again.",
      );
    this.calls++;
    const signals = [this.options.abortSignal, abortSignal].filter((s): s is AbortSignal => !!s);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    signal?.throwIfAborted();
    this.maybeAppendUserContent(request);
    const body = toOpenAIRequest(request, this.model, this.options.maxOutputTokens ?? 8192);
    try {
      const result = await this.options.transport.complete(body, signal);
      signal?.throwIfAborted();
      const choice = result.choices?.[0];
      if (
        !choice ||
        !choice.message ||
        (choice.message.content != null && typeof choice.message.content !== "string")
      )
        throw new Error("invalid model response");
      const parts: Part[] = [];
      const text = choice.message.content || "";
      if (
        choice.message.reasoning_content != null &&
        typeof choice.message.reasoning_content !== "string"
      )
        throw new Error("invalid model reasoning");
      if (choice.message.reasoning_content)
        parts.push({ text: choice.message.reasoning_content, thought: true });
      if (text) parts.push({ text });
      const calls = choice.message.tool_calls ?? [];
      if (!Array.isArray(calls) || calls.length > 100) throw new Error("invalid tool calls");
      for (const call of calls) {
        if (
          call.type !== "function" ||
          !call.id ||
          !call.function?.name ||
          typeof call.function.arguments !== "string"
        )
          throw new Error("invalid tool call");
        const args: unknown = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error("invalid tool arguments");
        parts.push({
          functionCall: {
            id: call.id,
            name: call.function.name,
            args: args as Record<string, unknown>,
          },
        });
      }
      if (!text.trim() && calls.length === 0)
        throw new ModelResolutionError(
          502,
          "Model returned no visible answer; try again or choose another model.",
        );
      // The browser protocol consumes text only from partial ADK events. Emit
      // one text delta for a non-streaming upstream, then the persisted final.
      if (stream !== false && text)
        yield { content: { role: "model", parts: [{ text }] }, partial: true };
      // Missing usage is not zero: ADK then falls back to text estimates for
      // compaction. Fabricating promptTokenCount=0 disables that fallback.
      const count = (n: unknown) =>
        typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
      const promptTokenCount = count(result.usage?.prompt_tokens),
        candidatesTokenCount = count(result.usage?.completion_tokens);
      const totalTokenCount =
        count(result.usage?.total_tokens) ??
        (promptTokenCount !== undefined && candidatesTokenCount !== undefined
          ? promptTokenCount + candidatesTokenCount
          : undefined);
      const usageMetadata = {
        ...(promptTokenCount !== undefined ? { promptTokenCount } : {}),
        ...(candidatesTokenCount !== undefined ? { candidatesTokenCount } : {}),
        ...(totalTokenCount !== undefined ? { totalTokenCount } : {}),
      };
      yield {
        content: { role: "model", parts },
        partial: false,
        ...(Object.keys(usageMetadata).length ? { usageMetadata } : {}),
        finishReason:
          choice.finish_reason === "length"
            ? "MAX_TOKENS"
            : choice.finish_reason === "content_filter"
              ? "SAFETY"
              : "STOP",
      } as LlmResponse;
    } catch (error) {
      throw safeModelError(error);
    }
  }
}

export function toOpenAIRequest(
  request: LlmRequest,
  model: string,
  maxOutputTokens: number,
): OpenAICompletionRequest {
  const messages: OpenAIMessage[] = [];
  const system = systemInstructionToString(request.config?.systemInstruction);
  if (system) messages.push({ role: "system", content: system });
  for (const content of request.contents ?? []) messages.push(...contentMessages(content));
  const tools: NonNullable<OpenAICompletionRequest["tools"]> = [];
  for (const tool of request.config?.tools ?? []) {
    if (!("functionDeclarations" in tool)) continue;
    for (const declaration of tool.functionDeclarations ?? []) {
      if (!declaration.name) continue;
      tools.push({
        type: "function",
        function: {
          name: declaration.name,
          ...(declaration.description ? { description: declaration.description } : {}),
          parameters:
            (declaration.parametersJsonSchema as Record<string, unknown> | undefined) ??
            (declaration.parameters
              ? genaiSchemaToJsonSchema(declaration.parameters)
              : { type: "object", properties: {} }),
        },
      });
    }
  }
  return {
    model,
    messages,
    stream: false,
    max_tokens: Math.min(request.config?.maxOutputTokens ?? 4096, maxOutputTokens),
    ...(tools.length ? { tools, tool_choice: "auto" as const } : {}),
  };
}
function contentMessages(content: Content): OpenAIMessage[] {
  const text = (content.parts ?? [])
    .flatMap((p) => (typeof p.text === "string" && !p.thought ? [p.text] : []))
    .join("\n");
  const reasoning = (content.parts ?? [])
    .flatMap((p) => (typeof p.text === "string" && p.thought ? [p.text] : []))
    .join("\n");
  const calls = (content.parts ?? []).flatMap((p) =>
    p.functionCall
      ? [
          {
            id: p.functionCall.id ?? "",
            type: "function" as const,
            function: {
              name: p.functionCall.name ?? "",
              arguments: JSON.stringify(p.functionCall.args ?? {}),
            },
          },
        ]
      : [],
  );
  const responses = (content.parts ?? []).flatMap((p) =>
    p.functionResponse
      ? [
          {
            role: "tool" as const,
            content: JSON.stringify(p.functionResponse.response ?? {}),
            tool_call_id: p.functionResponse.id ?? "",
          },
        ]
      : [],
  );
  const message: OpenAIMessage = {
    role: content.role === "model" ? "assistant" : "user",
    content: text || null,
    ...(reasoning && content.role === "model" ? { reasoning_content: reasoning } : {}),
    ...(calls.length ? { tool_calls: calls } : {}),
  };
  return [...(text || calls.length ? [message] : []), ...responses];
}
