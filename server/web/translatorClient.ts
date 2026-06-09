// Sidecar-only LLM client for /web/translate. Translates a document's markdown
// blocks to a target language in ONE non-streaming call (full-document context
// for coherence) and returns a block-aligned array.
//
// Deliberately does NOT reuse server/agent/minimaxLlm.ts — that adapter is bound
// to Google ADK's streaming `BaseLlm` interface. We talk to the same MiniMax
// (Anthropic-compatible) endpoint directly via @anthropic-ai/sdk, with an
// injectable `client` seam so tests never hit the network.

import Anthropic from "@anthropic-ai/sdk";

export type TranslatorErrorCode =
  | "translator_auth"
  | "translator_rate_limit"
  | "translator_timeout"
  | "translator_api"
  | "translator_invalid_response";

export class TranslatorClientError extends Error {
  readonly code: TranslatorErrorCode;
  constructor(code: TranslatorErrorCode, message: string) {
    super(message);
    this.name = "TranslatorClientError";
    this.code = code;
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicCreateResult {
  content: AnthropicContentBlock[];
  /** Why generation stopped. "max_tokens" means the reply was truncated. */
  stop_reason?: string | null;
}
export interface AnthropicLike {
  messages: {
    create(
      params: {
        model: string;
        max_tokens: number;
        system?: string;
        messages: Array<{ role: "user" | "assistant"; content: string }>;
      },
      options?: { signal?: AbortSignal },
    ): Promise<AnthropicCreateResult>;
  };
}

// MiniMax-M3 allows up to ~512K output tokens; a full-document translation (a
// JSON array of every text block's translation) easily exceeds the old 8K cap,
// which truncated the reply into invalid JSON and failed the job. 64K covers any
// realistic Base article; operators can raise it via DIKW_WEB_TRANSLATOR_MAX_TOKENS,
// and a reply that still hits the cap is caught via stop_reason in translate().
const DEFAULT_MAX_TOKENS = 64000;

/**
 * Client timeout (ms) for the single non-streaming translation call.
 *
 * The `@anthropic-ai/sdk` refuses a non-streaming `messages.create` whose
 * `max_tokens` could take longer than 10 minutes — UNLESS the client was built
 * with an explicit `timeout` (the guard in `calculateNonstreamingTimeout` only
 * runs when `_options.timeout == null`). Our 64K default cap estimates ~30 min,
 * so without this the call throws before any request leaves the process and
 * every translation fails. We keep the deliberate single non-streaming call and
 * set a timeout scaled to `max_tokens` (the SDK's own per-token estimate),
 * floored at 10 minutes so a large document neither trips the guard nor gets cut
 * off. The job runs detached behind the job+poll API, so a long timeout is safe.
 */
export function nonstreamingTimeoutMs(maxTokens: number): number {
  const tenMinutes = 10 * 60 * 1000;
  const estimate = Math.ceil((60 * 60 * 1000 * maxTokens) / 128000);
  return Math.max(tenMinutes, estimate);
}

const TARGET_LANG_NAMES: Record<string, string> = {
  zh: "Simplified Chinese",
  "zh-CN": "Simplified Chinese",
  en: "English",
};

export interface TranslatorClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Job-scoped abort signal; a cancel breaks the in-flight LLM call promptly. */
  signal?: AbortSignal;
  maxTokens?: number;
  /** Test seam: inject a fake transport. Defaults to a real `Anthropic` client. */
  client?: AnthropicLike;
}

export class TranslatorClient {
  private readonly client: AnthropicLike;
  private readonly model: string;
  private readonly signal?: AbortSignal;
  private readonly maxTokens: number;
  private readonly apiKey: string;

  constructor(opts: TranslatorClientOptions) {
    this.model = opts.model;
    this.signal = opts.signal;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.apiKey = opts.apiKey;
    // Auth: `x-api-key` (SDK default) is the live-verified method for MiniMax.
    // The explicit `timeout` is required — see nonstreamingTimeoutMs: without it
    // the SDK throws "Streaming is required…" for our large max_tokens.
    this.client =
      opts.client ??
      (new Anthropic({
        baseURL: opts.baseUrl,
        apiKey: opts.apiKey,
        timeout: nonstreamingTimeoutMs(this.maxTokens),
      }) as unknown as AnthropicLike);
  }

  /** Translate `blocks` (each a markdown source block) into `targetLang`.
   *  Returns translations aligned 1:1 with the input order. Throws a
   *  TranslatorClientError on transport failure or a malformed model reply. */
  async translate(blocks: string[], targetLang: string): Promise<string[]> {
    if (blocks.length === 0) return [];
    const langName = TARGET_LANG_NAMES[targetLang] ?? targetLang;
    let result: AnthropicCreateResult;
    try {
      result = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: buildSystemPrompt(langName),
          messages: [{ role: "user", content: JSON.stringify(blocks) }],
        },
        this.signal ? { signal: this.signal } : undefined,
      );
    } catch (err) {
      throw classifyError(err, this.apiKey);
    }
    if (result.stop_reason === "max_tokens") {
      throw new TranslatorClientError(
        "translator_invalid_response",
        "translation output was truncated (document too large for the configured max_tokens)",
      );
    }
    return parseTranslations(extractText(result), blocks.length);
  }
}

function buildSystemPrompt(langName: string): string {
  return [
    `You are a professional translator. You are given a JSON array of Markdown blocks from a single document. Translate each block into ${langName}.`,
    "",
    "Rules:",
    "- Return ONLY a JSON array of strings — the translations — with EXACTLY the same length and order as the input array. No prose, no explanation, no surrounding code fences.",
    "- Preserve all Markdown structure and syntax: heading markers (#), list markers, blockquotes (>), emphasis, inline code spans, and links.",
    "- For wikilinks written as [[target|label]] or [[target]], translate ONLY the visible label and keep the target identifier byte-for-byte unchanged. Never translate or rewrite the target.",
    "- Do not translate code, identifiers, file paths, or URLs.",
    "- Keep numbers, units, and dates unchanged.",
  ].join("\n");
}

function extractText(result: AnthropicCreateResult): string {
  return (result.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("");
}

/** Parse the model's reply into a string[] of `expected` length. Tolerates an
 *  accidental ```json … ``` fence wrapper, but rejects any other malformation
 *  (wrong length, non-array, non-string items) as translator_invalid_response so
 *  the job fails cleanly rather than rendering misaligned columns. */
function parseTranslations(text: string, expected: number): string[] {
  const stripped = stripCodeFence(text.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new TranslatorClientError(
      "translator_invalid_response",
      "translator did not return valid JSON",
    );
  }
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
    throw new TranslatorClientError(
      "translator_invalid_response",
      "translator response is not a JSON array of strings",
    );
  }
  if (parsed.length !== expected) {
    throw new TranslatorClientError(
      "translator_invalid_response",
      `translator returned ${parsed.length} blocks, expected ${expected}`,
    );
  }
  return parsed as string[];
}

function stripCodeFence(text: string): string {
  // Tolerate a ```json … ``` wrapper with or without inner newlines.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fence ? fence[1].trim() : text;
}

function classifyError(err: unknown, apiKey: string): TranslatorClientError {
  if (err instanceof TranslatorClientError) return err;
  const status = readStatus(err);
  const name = err instanceof Error ? err.name : "";
  // Scrub the key out of any upstream message before it can reach the job
  // record / browser — mirrors MineruClient, defending the "key never leaks"
  // invariant even though the SDK doesn't normally echo the x-api-key header.
  const message = scrub(err instanceof Error ? err.message : String(err), apiKey);
  if (status === 401 || status === 403) {
    return new TranslatorClientError("translator_auth", message);
  }
  if (status === 429) {
    return new TranslatorClientError("translator_rate_limit", message);
  }
  // 408/504 only appear when the upstream returns those HTTP codes; a genuine
  // client-side request timeout is the SDK's APIConnectionTimeoutError, which
  // carries no numeric status — match it by name so it maps to timeout, not api.
  if (status === 408 || status === 504 || name === "APIConnectionTimeoutError") {
    return new TranslatorClientError("translator_timeout", message);
  }
  return new TranslatorClientError("translator_api", message);
}

function redact(token: string): string {
  if (!token) return "";
  return `…${token.slice(-4)}`;
}

function scrub(message: string, token: string): string {
  if (!token || !message.includes(token)) return message;
  return message.split(token).join(redact(token));
}

function readStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}
