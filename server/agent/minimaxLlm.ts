import Anthropic from "@anthropic-ai/sdk";
import { BaseLlm } from "@google/adk";
import type { LlmRequest, LlmResponse } from "@google/adk";
import type {
  Content,
  FunctionDeclaration,
  Part,
  Schema
} from "@google/genai";

/**
 * Custom ADK LLM adapter for MiniMax via its Anthropic-compatible endpoint.
 *
 * MiniMax exposes an Anthropic Messages API at `${baseUrl}/v1/messages`. We use
 * the official `@anthropic-ai/sdk` as transport and translate, deterministically,
 * between ADK/genai shapes (`LlmRequest`/`LlmResponse`, genai `Content`/`Part`)
 * and Anthropic message shapes.
 *
 * Live-verified (2026-06): auth via `x-api-key` (the SDK default) works directly
 * against `https://api.minimaxi.com/anthropic`; no Bearer token and no proxy are
 * needed. `MiniMax-M3` is accepted and returns `usage` token counts. The model
 * additionally emits `thinking` content blocks (and `thinking_delta` stream
 * events) which we intentionally drop — only `text`/`tool_use` cross the boundary.
 */

/** Minimal slice of the Anthropic message shape we consume. */
interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | { type: string; [key: string]: unknown };

interface AnthropicMessage {
  content: AnthropicContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string | null;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

/** Stream handle returned by `messages.stream(...)`. */
type AnthropicStream = AsyncIterable<AnthropicStreamEvent> & {
  finalMessage(): Promise<AnthropicMessage>;
};

/**
 * Transport seam so unit tests can inject a fake client (no network). Matches
 * the relevant surface of `Anthropic.messages`.
 */
export interface AnthropicLike {
  messages: {
    stream(params: AnthropicMessageParams, options?: { signal?: AbortSignal }): AnthropicStream;
  };
}

/** Anthropic message-create / stream params we produce. */
interface AnthropicMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessageParam[];
  tools?: AnthropicTool[];
}

interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: AnthropicContentBlockParam[];
}

type AnthropicContentBlockParam =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JsonSchema;
}

/** JSON-Schema subset we emit from genai `Schema`. */
interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  [key: string]: unknown;
}

export interface MiniMaxLlmOptions {
  model: string;
  apiKey: string;
  baseUrl: string;
  /**
   * Turn-level abort signal applied to every call. ADK's context-compaction
   * summarizer invokes `generateContentAsync(request, false)` without a per-call
   * signal, so without this an in-flight summarization would ignore a user
   * Stop. Merged with the per-call signal via `AbortSignal.any`.
   */
  abortSignal?: AbortSignal;
  /** Test seam: inject a fake transport. Defaults to a real `Anthropic` client. */
  client?: AnthropicLike;
}

const DEFAULT_MAX_TOKENS = 4096;

export class MiniMaxLlm extends BaseLlm {
  private readonly client: AnthropicLike;
  private readonly abortSignal?: AbortSignal;

  constructor(opts: MiniMaxLlmOptions) {
    super({ model: opts.model });
    this.abortSignal = opts.abortSignal;
    // Auth: `x-api-key` (SDK default) is the live-verified method for MiniMax.
    this.client =
      opts.client ?? (new Anthropic({ baseURL: opts.baseUrl, apiKey: opts.apiKey }) as unknown as AnthropicLike);
  }

  async connect(): Promise<never> {
    throw new Error("MiniMaxLlm does not support live/bidi connect");
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    stream?: boolean,
    abortSignal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void> {
    this.maybeAppendUserContent(llmRequest);

    const params = this.toAnthropicParams(llmRequest);
    const signal = mergeAbortSignals(this.abortSignal, abortSignal);
    const anthropicStream = this.client.messages.stream(params, signal ? { signal } : {});

    // ADK convention: when `stream === false` the adapter must NOT emit
    // per-chunk partials, only the single final non-partial response. We still
    // consume the stream (the SDK builds the final message from its events).
    const emitPartials = stream !== false;
    for await (const event of anthropicStream) {
      if (emitPartials && event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield {
          content: { role: "model", parts: [{ text: event.delta.text ?? "" }] },
          partial: true
        };
      }
    }

    const final = await anthropicStream.finalMessage();
    const parts: Part[] = [];
    for (const block of final.content) {
      if (block.type === "text") {
        parts.push({ text: (block as AnthropicTextBlock).text });
      } else if (block.type === "tool_use") {
        const tool = block as AnthropicToolUseBlock;
        parts.push({
          functionCall: {
            id: tool.id,
            name: tool.name,
            args: (tool.input ?? {}) as Record<string, unknown>
          }
        });
      }
      // Other block kinds (e.g. MiniMax `thinking`) are intentionally dropped.
    }

    const promptTokenCount = final.usage.input_tokens;
    const candidatesTokenCount = final.usage.output_tokens;
    yield {
      content: { role: "model", parts },
      partial: false,
      usageMetadata: {
        promptTokenCount,
        candidatesTokenCount,
        totalTokenCount: promptTokenCount + candidatesTokenCount
      },
      finishReason: mapFinishReason(final.stop_reason)
    };
  }

  private toAnthropicParams(llmRequest: LlmRequest): AnthropicMessageParams {
    const config = llmRequest.config ?? {};
    const params: AnthropicMessageParams = {
      model: this.model,
      max_tokens: config.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(llmRequest.contents ?? [])
    };

    const system = systemInstructionToString(config.systemInstruction);
    if (system) {
      params.system = system;
    }

    const tools = toAnthropicTools(config.tools);
    if (tools.length > 0) {
      params.tools = tools;
    }

    return params;
  }
}

/**
 * Combine the turn-level and per-call abort signals; undefined when neither is
 * set. Identical references are deduped so the common case (ADK forwards the
 * same turn signal as the per-call arg) reuses the single signal instead of
 * allocating a fresh `AbortSignal.any` composite on every call.
 */
function mergeAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  const signals = [...new Set([a, b].filter((signal): signal is AbortSignal => signal !== undefined))];
  if (signals.length === 0) {
    return undefined;
  }
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Map genai `contents` → Anthropic `messages`, merging consecutive same-role turns. */
function toAnthropicMessages(contents: Content[]): AnthropicMessageParam[] {
  const messages: AnthropicMessageParam[] = [];
  for (const content of contents) {
    const { role, blocks } = contentToAnthropic(content);
    if (blocks.length === 0) {
      continue;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      messages.push({ role, content: blocks });
    }
  }
  return messages;
}

/**
 * Convert one genai `Content` to an Anthropic role + content blocks.
 *
 * A genai turn carrying a `functionResponse` is a tool result, which Anthropic
 * requires to live in a USER turn — so any part producing a `tool_result` forces
 * the whole message to the user role. Otherwise role follows genai: model→assistant.
 */
function contentToAnthropic(content: Content): { role: "user" | "assistant"; blocks: AnthropicContentBlockParam[] } {
  const blocks: AnthropicContentBlockParam[] = [];
  let hasToolResult = false;
  for (const part of content.parts ?? []) {
    const block = partToBlock(part);
    if (!block) {
      continue;
    }
    if (block.type === "tool_result") {
      hasToolResult = true;
    }
    blocks.push(block);
  }
  const role = hasToolResult ? "user" : content.role === "model" ? "assistant" : "user";
  return { role, blocks };
}

function partToBlock(part: Part): AnthropicContentBlockParam | null {
  if (typeof part.text === "string") {
    return { type: "text", text: part.text };
  }
  if (part.functionCall) {
    const call = part.functionCall;
    return {
      type: "tool_use",
      id: call.id ?? "",
      name: call.name ?? "",
      input: call.args ?? {}
    };
  }
  if (part.functionResponse) {
    const resp = part.functionResponse;
    return {
      type: "tool_result",
      tool_use_id: resp.id ?? "",
      content: JSON.stringify(resp.response ?? {})
    };
  }
  return null;
}

function systemInstructionToString(instruction: unknown): string | undefined {
  if (instruction == null) {
    return undefined;
  }
  if (typeof instruction === "string") {
    return instruction;
  }
  // ContentUnion: a Content, a Part[], or a Part. Collect all text fragments.
  const texts: string[] = [];
  const collect = (value: unknown): void => {
    if (value == null) {
      return;
    }
    if (typeof value === "string") {
      texts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        collect(item);
      }
      return;
    }
    if (typeof value === "object") {
      const obj = value as { parts?: unknown; text?: unknown };
      if (typeof obj.text === "string") {
        texts.push(obj.text);
      }
      if (obj.parts !== undefined) {
        collect(obj.parts);
      }
    }
  };
  collect(instruction);
  const joined = texts.join("\n");
  return joined.length > 0 ? joined : undefined;
}

function toAnthropicTools(tools: unknown): AnthropicTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const out: AnthropicTool[] = [];
  for (const tool of tools) {
    const declarations = (tool as { functionDeclarations?: FunctionDeclaration[] })?.functionDeclarations;
    if (!Array.isArray(declarations)) {
      continue;
    }
    for (const decl of declarations) {
      if (!decl.name) {
        continue;
      }
      const inputSchema = decl.parameters
        ? (genaiSchemaToJsonSchema(decl.parameters) as JsonSchema)
        : { type: "object", properties: {} };
      out.push({
        name: decl.name,
        ...(decl.description ? { description: decl.description } : {}),
        input_schema: inputSchema
      });
    }
  }
  return out;
}

/**
 * Recursively convert a genai `Schema` (UPPERCASE `type` like "OBJECT"/"STRING")
 * to a JSON-Schema object (lowercase "object"/"string"), recursing into
 * `properties`/`items` and preserving `description`/`required`/`enum`.
 */
export function genaiSchemaToJsonSchema(schema: Schema): JsonSchema {
  const out: JsonSchema = {};
  if (schema.type) {
    out.type = String(schema.type).toLowerCase();
  }
  if (schema.description) {
    out.description = schema.description;
  }
  if (schema.enum) {
    out.enum = schema.enum;
  }
  if (schema.required) {
    out.required = schema.required;
  }
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = genaiSchemaToJsonSchema(value);
    }
  }
  if (schema.items) {
    out.items = genaiSchemaToJsonSchema(schema.items);
  }
  return out;
}

/** Anthropic `stop_reason` → genai `FinishReason` string value. */
function mapFinishReason(stopReason: string | null): LlmResponse["finishReason"] {
  switch (stopReason) {
    case "end_turn":
    case "tool_use":
    case "stop_sequence":
      return "STOP" as LlmResponse["finishReason"];
    case "max_tokens":
      return "MAX_TOKENS" as LlmResponse["finishReason"];
    case "refusal":
      return "SAFETY" as LlmResponse["finishReason"];
    default:
      return "FINISH_REASON_UNSPECIFIED" as LlmResponse["finishReason"];
  }
}
