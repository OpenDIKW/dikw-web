// Sidecar-only LLM client for /web/translate. Translates a document's markdown
// blocks to a target language in ONE call (full-document context for coherence)
// and returns a block-aligned array.
//
// The call is STREAMING (`messages.stream(...).finalMessage()`): a whole-document
// translation can emit tens of thousands of tokens over several minutes, and a
// non-streaming request holds the connection idle until the entire body is
// generated — vulnerable to gateway idle-timeouts and the SDK's own
// "Streaming is required for operations that may take longer than 10 minutes"
// guard. Streaming keeps bytes flowing, so it is the more reliable transport for
// large outputs; the sidecar buffers the full stream server-side, so the
// browser-facing job+poll contract (whole result at once) is unchanged.
//
// Deliberately does NOT reuse server/agent/minimaxLlm.ts — that adapter is bound
// to Google ADK's `BaseLlm` interface. We talk to the same MiniMax
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
  /** Whether re-issuing the same call could plausibly succeed. Transport faults
   *  (rate limit, timeout, 5xx, connection errors) are retryable; auth failures,
   *  permanent 4xx, aborts, and a malformed model reply are not. */
  readonly retryable: boolean;
  constructor(code: TranslatorErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "TranslatorClientError";
    this.code = code;
    this.retryable = retryable;
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
interface AnthropicMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}
/** Minimal view of `Anthropic.Messages.MessageStream` we depend on. */
export interface AnthropicMessageStream {
  finalMessage(): Promise<AnthropicCreateResult>;
}
export interface AnthropicLike {
  messages: {
    stream(
      params: AnthropicMessageParams,
      options?: { signal?: AbortSignal },
    ): AnthropicMessageStream;
  };
}

// MiniMax-M3 allows up to ~512K output tokens; a full-document translation (a
// JSON array of every text block's translation) easily exceeds the old 8K cap,
// which truncated the reply into invalid JSON and failed the job. 64K covers any
// realistic Base article; operators can raise it via DIKW_WEB_TRANSLATOR_MAX_TOKENS,
// and a reply that still hits the cap is caught via stop_reason in translate().
const DEFAULT_MAX_TOKENS = 64000;

/** Transport-level retries our wrapper performs (in addition to the first try)
 *  on a retryable failure. The real SDK client is built with `maxRetries: 0` so
 *  retry policy is single-sourced here, where it is observable and testable. */
const DEFAULT_MAX_RETRIES = 2;
/** Base backoff delay (ms) for the first retry; doubles each subsequent retry. */
const DEFAULT_RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8000;

/**
 * Overall request timeout (ms) for the streaming translation call, scaled to
 * `max_tokens`. With streaming the SDK's non-streaming guard never fires, but
 * the SDK's default request timeout is only 10 minutes — a long document whose
 * stream legitimately runs longer would be cut off. We size the timeout to the
 * SDK's own per-token generation estimate (`60min × maxTokens / 128000`),
 * floored at 10 minutes, so neither a small nor a very large document is severed
 * mid-stream. The job runs detached behind job+poll, so a long timeout is safe.
 */
export function translationTimeoutMs(maxTokens: number): number {
  const tenMinutes = 10 * 60 * 1000;
  const estimate = Math.ceil((60 * 60 * 1000 * maxTokens) / 128000);
  return Math.max(tenMinutes, estimate);
}

/** Exponential backoff with full +25% jitter, capped. `retry` is 1-based. */
export function backoffDelayMs(
  retry: number,
  baseMs: number = DEFAULT_RETRY_BASE_MS,
  capMs: number = RETRY_CAP_MS,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** (retry - 1));
  const jitter = Math.random() * exp * 0.25;
  return Math.round(exp + jitter);
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
  /** Transport retries on a retryable failure (default 2). */
  maxRetries?: number;
  /** Base backoff delay (ms); tests pass 0 to retry without real timers. */
  retryBaseMs?: number;
  /** Test seam: inject a fake transport. Defaults to a real `Anthropic` client. */
  client?: AnthropicLike;
}

export class TranslatorClient {
  private readonly client: AnthropicLike;
  private readonly model: string;
  private readonly signal?: AbortSignal;
  private readonly maxTokens: number;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: TranslatorClientOptions) {
    this.model = opts.model;
    this.signal = opts.signal;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    // Auth: `x-api-key` (SDK default) is the live-verified method for MiniMax.
    // `timeout` (see translationTimeoutMs) keeps a long stream from being cut at
    // the SDK's 10-minute default. `maxRetries: 0` disables the SDK's own retry
    // so backoff is single-sourced in callWithRetry (which also covers
    // mid-stream failures the SDK would not retry).
    this.client =
      opts.client ??
      (new Anthropic({
        baseURL: opts.baseUrl,
        apiKey: opts.apiKey,
        timeout: translationTimeoutMs(this.maxTokens),
        maxRetries: 0,
      }) as unknown as AnthropicLike);
  }

  /** Translate `blocks` (each a markdown source block) into `targetLang`.
   *  Returns translations aligned 1:1 with the input order. Throws a
   *  TranslatorClientError on transport failure or a malformed model reply. */
  async translate(blocks: string[], targetLang: string): Promise<string[]> {
    if (blocks.length === 0) return [];
    const langName = TARGET_LANG_NAMES[targetLang] ?? targetLang;
    const result = await this.callWithRetry({
      model: this.model,
      max_tokens: this.maxTokens,
      system: buildSystemPrompt(langName),
      messages: [{ role: "user", content: JSON.stringify(blocks) }],
    });
    if (result.stop_reason === "max_tokens") {
      throw new TranslatorClientError(
        "translator_invalid_response",
        "translation output was truncated (document too large for the configured max_tokens)",
      );
    }
    return parseTranslations(extractText(result), blocks.length);
  }

  /** Issue the streaming call, retrying retryable transport faults with
   *  exponential backoff. Parsing happens once in `translate`, OUTSIDE this loop,
   *  so a malformed reply never triggers a retry. */
  private async callWithRetry(params: AnthropicMessageParams): Promise<AnthropicCreateResult> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.signal?.aborted) {
        throw new TranslatorClientError("translator_api", "translation aborted", false);
      }
      try {
        const stream = this.client.messages.stream(
          params,
          this.signal ? { signal: this.signal } : undefined,
        );
        return await stream.finalMessage();
      } catch (err) {
        const classified = classifyError(err, this.apiKey);
        if (!classified.retryable || attempt >= this.maxRetries || this.signal?.aborted) {
          throw classified;
        }
        await sleep(backoffDelayMs(attempt + 1, this.retryBaseMs), this.signal);
      }
    }
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

/** Resolve after `ms`, or early if `signal` aborts (the caller re-checks
 *  `signal.aborted` and bails). Never rejects, so it can't mask the real error. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function classifyError(err: unknown, apiKey: string): TranslatorClientError {
  if (err instanceof TranslatorClientError) return err;
  const status = readStatus(err);
  const name = err instanceof Error ? err.name : "";
  // Scrub the key out of any upstream message before it can reach the job
  // record / browser — mirrors MineruClient, defending the "key never leaks"
  // invariant even though the SDK doesn't normally echo the x-api-key header.
  const message = scrub(err instanceof Error ? err.message : String(err), apiKey);
  // A user/job abort must never be retried — surface it immediately.
  if (name === "APIUserAbortError" || name === "AbortError") {
    return new TranslatorClientError("translator_api", message, false);
  }
  if (status === 401 || status === 403) {
    return new TranslatorClientError("translator_auth", message, false);
  }
  if (status === 429) {
    return new TranslatorClientError("translator_rate_limit", message, true);
  }
  // 408/504 only appear when the upstream returns those HTTP codes; a genuine
  // client-side request timeout is the SDK's APIConnectionTimeoutError, which
  // carries no numeric status — match it by name so it maps to timeout, not api.
  if (status === 408 || status === 504 || name === "APIConnectionTimeoutError") {
    return new TranslatorClientError("translator_timeout", message, true);
  }
  // Retry transport faults: 5xx, 409 conflict, and connection errors that carry
  // no HTTP status. Other 4xx (400/422/...) are permanent → not retryable.
  const retryable = status === undefined || status === 409 || (status >= 500 && status <= 599);
  return new TranslatorClientError("translator_api", message, retryable);
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
