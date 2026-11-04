import type { IncomingMessage } from "node:http";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import type { SessionIdentity } from "../auth/sessionValidation.js";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}
export interface OpenAICompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: false;
  max_tokens?: number;
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters: Record<string, unknown> };
  }>;
  tool_choice?: "auto" | "none" | "required";
}
export interface OpenAICompletionResponse {
  choices: Array<{
    message: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAIMessage["tool_calls"];
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
/** Server-only closure; never put it, credentials, or identity into session state. */
export interface RequestModel {
  model: string;
  complete(
    body: OpenAICompletionRequest,
    signal?: AbortSignal,
    identity?: Readonly<SessionIdentity>,
  ): Promise<OpenAICompletionResponse>;
}
export type ModelFeature = "agent" | "translation" | "knowledge";
export type ModelResolver = (context: {
  request: IncomingMessage;
  identity: Readonly<SessionIdentity>;
  feature: ModelFeature;
  signal?: AbortSignal;
}) => Promise<RequestModel>;
export type RequestModelFor = (
  request: IncomingMessage,
  feature: ModelFeature,
  signal?: AbortSignal,
) => Promise<RequestModel>;
/** Only deliberate, credential-free messages may cross the public boundary. */
export class ModelResolutionError extends Error {
  /** Server-only opt-out; HTTP boundaries still send only safe status/message. */
  readonly retryable?: false;
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    message: string,
    options?: { retryable?: false },
  ) {
    super(message);
    this.name = "ModelResolutionError";
    this.retryable = options?.retryable;
  }
}
export function safeModelError(error: unknown): ModelResolutionError {
  if (error instanceof ModelResolutionError) return error;
  if (
    error instanceof APIUserAbortError ||
    (error instanceof Error && ["AbortError", "APIUserAbortError"].includes(error.name))
  )
    return new ModelResolutionError(503, "Model request cancelled.", { retryable: false });
  return new ModelResolutionError(
    503,
    "Model service unavailable; check your model settings and try again.",
  );
}
