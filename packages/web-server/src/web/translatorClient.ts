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
import { createLogger } from "../shared/logger.js";

const log = createLogger("translate");

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
   *  permanent 4xx, and aborts are not. A malformed reply is retried separately
   *  inside `translate()` (it's usually transient model misbehavior), so this
   *  flag governs transport classification only. */
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

// Block boundary for the request/response protocol. Blocks are joined with this
// sentinel and the model returns translations separated by the same sentinel.
// A delimiter — NOT JSON — because the content is arbitrary scientific Markdown:
// LaTeX (`\circ`, `\mathrm`), unescaped quotes around code identifiers
// (`"scikit-learn"`), and brackets all appear verbatim and would corrupt a JSON
// array (live-observed on cho-cqa). A delimiter needs no escaping, so any
// character passes through untouched. The token is distinctive ASCII the model
// reproduces reliably and that cannot occur in real prose.
const BLOCK_SEP = "<<<<<DIKW_BLOCK_BREAK>>>>>";
const BLOCK_SEP_JOIN = `\n\n${BLOCK_SEP}\n\n`;
// Tolerate the model varying the `<`/`>` run length or the surrounding whitespace.
const BLOCK_SEP_RE = /\s*<{3,}\s*DIKW_BLOCK_BREAK\s*>{3,}\s*/;

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
   *  Returns translations aligned 1:1 with the input order. */
  async translate(blocks: string[], targetLang: string): Promise<string[]> {
    if (blocks.length === 0) return [];
    const langName = TARGET_LANG_NAMES[targetLang] ?? targetLang;
    const arr = await this.translateBlocks(blocks, langName);
    return this.repairBlocks(blocks, arr, langName);
  }

  /** Self-heal two model failure modes the 1:1 count check can't catch, by
   *  re-asking the offending block ALONE once (the miscount-/ramble-prone batch
   *  context is gone, so a focused call usually behaves). Each is bounded to a
   *  single re-ask so a stubborn block can never loop the job. Chinese target only.
   *
   *  1. **Echoed untranslated** — the model returned the block verbatim in its
   *     source language (no CJK). Re-ask; accept whatever returns.
   *  2. **Oversized (likely hallucinated)** — EN→中 normally COMPRESSES, so a
   *     translation several× longer than its source means the model appended
   *     invented content (live-observed on test2.md: a reference translated, then
   *     an unrelated section + paragraph tacked on). Re-ask; accept only if the
   *     re-ask is no longer oversized — otherwise fall back to the SOURCE text,
   *     because showing the untranslated original is safer than injecting a
   *     fabricated translation. */
  private async repairBlocks(
    srcBlocks: string[],
    arr: string[],
    langName: string,
  ): Promise<string[]> {
    if (!isChineseTarget(langName)) return arr;
    const out = arr.slice();
    for (let i = 0; i < srcBlocks.length; i += 1) {
      const src = srcBlocks[i];
      const tr = out[i] ?? "";
      const reason = looksUntranslated(src, tr)
        ? "untranslated"
        : looksOversized(src, tr)
          ? "oversized"
          : null;
      if (!reason) continue;
      const retried = (await this.translateBlocks([src], langName))[0] ?? "";
      if (retried.trim().length === 0) continue; // empty re-ask → keep the original
      // Re-validate the re-ask: never accept a result that is still oversized or
      // echoes the source — fall back to the source text rather than inject
      // bloated/fabricated content. (A still-untranslated but normal-length reply
      // is accepted: some blocks — names, identifiers — legitimately stay English.)
      if (looksOversized(src, retried)) {
        out[i] = src;
        log.warn("block still oversized/echoed after re-ask; falling back to source", {
          block: i,
          was: reason,
        });
      } else {
        out[i] = retried;
        log.warn("block repaired via singleton re-ask", { block: i, was: reason });
      }
    }
    return out;
  }

  /** Translate `blocks` into the resolved `langName`, returning an array aligned
   *  1:1 with the input. A single streaming call usually returns the exact count;
   *  when the model merges or splits blocks and returns the WRONG count, we do
   *  NOT re-ask the identical request — that miscount is often deterministic
   *  (live-observed: "returned 10, expected 11" repeating across retries, because
   *  the model keeps merging the same adjacent pair). Instead we split the batch
   *  in half and translate each half, recursing down to singletons. Splitting
   *  breaks the merge-prone adjacency, so the halves align; a singleton can't be
   *  miscounted against siblings, so if its reply still has the wrong number of
   *  pieces we join them into the one translation that block must have. This
   *  converges deterministically and keeps one stubborn batch from failing the
   *  whole job. */
  private async translateBlocks(blocks: string[], langName: string): Promise<string[]> {
    const arr = await this.translateOnce(blocks, langName);
    if (arr.length === blocks.length) return arr;
    if (blocks.length === 1) {
      // The model split one source block into several pieces (or returned none) —
      // they all belong to this block, so join them into a single translation.
      return [arr.join("\n\n")];
    }
    log.warn("batch returned wrong block count; splitting and re-translating the halves", {
      expected: blocks.length,
      got: arr.length,
    });
    const mid = Math.ceil(blocks.length / 2);
    const left = await this.translateBlocks(blocks.slice(0, mid), langName);
    const right = await this.translateBlocks(blocks.slice(mid), langName);
    return [...left, ...right];
  }

  /** One streaming translation call, returning the model's array verbatim (any
   *  length — length reconciliation is `translateBlocks`'s job). Retries retryable
   *  transport faults AND a transient malformed reply (MiniMax occasionally wraps
   *  the JSON in prose or emits invalid JSON; a re-ask usually returns clean
   *  output). A truncated reply (deterministic at the cap) and aborts are not
   *  retried. */
  private async translateOnce(blocks: string[], langName: string): Promise<string[]> {
    const params: AnthropicMessageParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: buildSystemPrompt(langName),
      messages: [{ role: "user", content: blocks.join(BLOCK_SEP_JOIN) }],
    };
    for (let attempt = 0; ; attempt += 1) {
      if (this.signal?.aborted) {
        throw new TranslatorClientError("translator_api", "translation aborted", false);
      }
      let result: AnthropicCreateResult;
      try {
        const stream = this.client.messages.stream(
          params,
          this.signal ? { signal: this.signal } : undefined,
        );
        result = await stream.finalMessage();
      } catch (err) {
        const classified = classifyError(err, this.apiKey);
        if (!classified.retryable || attempt >= this.maxRetries || this.signal?.aborted) {
          throw classified;
        }
        await sleep(backoffDelayMs(attempt + 1, this.retryBaseMs), this.signal);
        continue;
      }
      // A truncated reply is deterministic at the configured cap — retrying would
      // truncate again, so fail immediately rather than burn attempts.
      if (result.stop_reason === "max_tokens") {
        throw new TranslatorClientError(
          "translator_invalid_response",
          "translation output was truncated (document too large for the configured max_tokens)",
        );
      }
      const parts = splitTranslations(extractText(result));
      if (parts.length > 0) return parts;
      // Empty reply — nothing usable. Usually transient; re-ask while attempts
      // remain, then surface the error.
      if (attempt >= this.maxRetries || this.signal?.aborted) {
        throw new TranslatorClientError(
          "translator_invalid_response",
          "translator returned an empty reply",
        );
      }
      await sleep(backoffDelayMs(attempt + 1, this.retryBaseMs), this.signal);
    }
  }
}

function buildSystemPrompt(langName: string): string {
  return [
    `You are a professional translator. The user message contains one or more Markdown blocks from a single document, separated by a line that reads exactly:`,
    BLOCK_SEP,
    `Translate each block into ${langName}.`,
    "",
    "Rules:",
    `- Return ONLY the translated blocks, in the same order, separated by that exact same line (${BLOCK_SEP}). Return the SAME number of blocks you received. No preamble, no commentary, no numbering, no surrounding code fences.`,
    "- Translate ONLY what is given. Do NOT add, continue, summarize, explain, or invent any content: no extra sentences, paragraphs, sections, outlines, or headings that are not present in the source block. Each output block must be a faithful translation of the corresponding input block and nothing more.",
    "- Preserve all Markdown structure and syntax: heading markers (#), list markers, blockquotes (>), emphasis, inline code spans, links, and LaTeX/math exactly (including backslash commands such as \\circ, \\mathrm, \\times).",
    "- For wikilinks written as [[target|label]] or [[target]], translate ONLY the visible label and keep the target identifier byte-for-byte unchanged. Never translate or rewrite the target.",
    "- Do not translate code, identifiers, file paths, or URLs.",
    "- Keep numbers, units, and dates unchanged.",
  ].join("\n");
}

// Han ideographs (incl. extension A and the compatibility block) — presence of
// any one means the text carries Chinese, i.e. it was translated, not echoed.
const CJK_RE = /[㐀-鿿豈-﫿]/;
// A "word" of real prose: a run of 2+ Latin letters (skips lone initials/digits).
const LATIN_WORD_RE = /[A-Za-z]{2,}/g;
// Minimum English words a block must have before a missing translation counts as
// a failure. High enough that short non-prose (citations, acronyms, captions,
// identifiers) the model legitimately leaves in English isn't force-re-translated.
const MIN_PROSE_WORDS = 6;
// Oversized-translation guard. EN→中 compresses (Chinese is far denser per char),
// so a faithful translation is usually shorter than its source; several× longer
// means the model appended invented content. The length floor keeps the ratio
// from firing on tiny inputs (acronyms / short terms legitimately expand).
const MIN_LEN_FOR_RATIO = 60;
const MAX_EXPANSION_RATIO = 2;

function isChineseTarget(langName: string): boolean {
  return /chinese/i.test(langName);
}

/** True when a Chinese-target block was returned untranslated: the source has
 *  enough English prose to expect a translation, yet the result contains no CJK
 *  at all (the model echoed the English). Callers gate on a Chinese target. */
function looksUntranslated(src: string, tr: string): boolean {
  const words = src.match(LATIN_WORD_RE)?.length ?? 0;
  if (words < MIN_PROSE_WORDS) return false;
  return !CJK_RE.test(tr);
}

/** True when a translation carries content it shouldn't — the signature of the
 *  model appending hallucinated/continued text or echoing the source back. Only
 *  meaningful for a Chinese target (callers gate on that) and only above a length
 *  floor, so short blocks that legitimately expand don't trip it. Two signals:
 *  (a) the translation literally contains the whole source block verbatim (the
 *  model echoed the English and appended a translation), and (b) EN→中 compresses,
 *  so a translation more than ~2× its source length is implausible. */
function looksOversized(src: string, tr: string): boolean {
  const s = src.trim();
  if (s.length < MIN_LEN_FOR_RATIO) return false;
  if (tr.includes(s)) return true;
  return tr.length > s.length * MAX_EXPANSION_RATIO;
}

function extractText(result: AnthropicCreateResult): string {
  return (result.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("");
}

/** Split the model's reply into translated blocks on the BLOCK_SEP sentinel.
 *  Content between separators is taken verbatim — no unescaping — so quotes,
 *  backslashes, LaTeX, and brackets all survive. Strips a wrapping code fence,
 *  trims each part, and drops empty parts (boundary artifacts when the model
 *  emits a leading/trailing separator). Returns [] for an empty reply. Length
 *  reconciliation against the block count is `translateBlocks`'s job (it splits
 *  the batch rather than failing on a wrong count). */
function splitTranslations(text: string): string[] {
  const trimmed = stripCodeFence(text.trim());
  if (trimmed.length === 0) return [];
  return trimmed
    .split(BLOCK_SEP_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripCodeFence(text: string): string {
  // Tolerate a ``` … ``` wrapper with or without a language tag / inner newlines.
  const fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text);
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
