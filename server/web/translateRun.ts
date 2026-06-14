// Detached runner for /web/translate jobs (mirrors http.ts `runConversion`).
// Runs the LLM translation off the request lifetime, re-pins wikilink targets
// defensively, and stores the block-aligned result as JSON bytes on the job.
//
// Translation is CHUNKED: the document's text blocks are split into batches and
// translated one LLM call per batch, sequentially in document order. After each
// batch the runner publishes the blocks-so-far as the job's `progress`, so the
// browser (polling the status endpoint) reveals translated paragraphs as they
// land instead of staring at a loading skeleton until the whole document is
// done. The tradeoff vs one whole-document call is some loss of cross-batch
// context — bounded by sizing a batch at several paragraphs (see the caps
// below) so local coherence is preserved. See docs/adr/0003-bilingual-reading.md.

import type { JobStore } from "./jobStore.js";
import { TranslatorClient, TranslatorClientError } from "./translatorClient.js";
import { type JobOutcome, recordJobEnd, recordJobStart } from "../shared/metrics.js";

export interface TranslateRunArgs {
  client: TranslatorClient;
  blocks: string[];
  targetLang: string;
}

/** A batch translated in one LLM call, with the global index of its first block
 *  so per-batch results can be mapped back to absolute positions. */
export interface TranslateBatch {
  start: number;
  blocks: string[];
}

/** Max text blocks per batch — small enough that the first batch returns within
 *  a few seconds (fast first paint of the translation) while still bundling
 *  enough paragraphs to keep local translation context. */
export const MAX_BLOCKS_PER_BATCH = 12;
/** Max source characters per batch — a second cap so a handful of very long
 *  paragraphs don't produce an oversized, slow call. */
export const MAX_CHARS_PER_BATCH = 4000;

/** Greedily pack `blocks` into ordered batches, cutting when adding the next
 *  block would exceed either cap. A single block larger than the char cap still
 *  goes in its own batch (never split a block — that would break markdown). */
export function splitIntoBatches(
  blocks: string[],
  maxBlocks: number = MAX_BLOCKS_PER_BATCH,
  maxChars: number = MAX_CHARS_PER_BATCH,
): TranslateBatch[] {
  const batches: TranslateBatch[] = [];
  let current: string[] = [];
  let start = 0;
  let chars = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const wouldExceed =
      current.length > 0 && (current.length >= maxBlocks || chars + block.length > maxChars);
    if (wouldExceed) {
      batches.push({ start, blocks: current });
      current = [];
      start = i;
      chars = 0;
    }
    current.push(block);
    chars += block.length;
  }
  if (current.length > 0) batches.push({ start, blocks: current });
  return batches;
}

/** The translation pipeline, detached from any HTTP request. Translates the
 *  document batch by batch, publishing partial progress after each, and stores
 *  the full block-aligned JSON on success / a mapped error code on any failure.
 *  MUST NOT let a rejection escape this `void`-ed promise. */
export async function runTranslation(
  store: JobStore,
  jobId: string,
  args: TranslateRunArgs,
): Promise<void> {
  const startedAt = Date.now();
  const total = args.blocks.length;
  const batches = splitIntoBatches(args.blocks);
  log(jobId, `start: ${total} blocks → ${batches.length} batches (lang ${args.targetLang})`);
  recordJobStart("translate");
  let outcome: JobOutcome = "succeeded";
  try {
    store.setRunning(jobId);
    const done: Array<{ i: number; tr: string }> = [];
    for (let b = 0; b < batches.length; b += 1) {
      const batch = batches[b];
      const batchStartedAt = Date.now();
      const translated = await args.client.translate(batch.blocks, args.targetLang);
      for (let j = 0; j < translated.length; j += 1) {
        const i = batch.start + j;
        done.push({ i, tr: repinWikilinks(args.blocks[i], translated[j]) });
      }
      // Publish the blocks-so-far so the browser can reveal them mid-flight.
      store.setProgress(jobId, { done: done.length, total, blocks: done.slice() });
      log(
        jobId,
        `batch ${b + 1}/${batches.length} (${batch.blocks.length} blocks) ok in ${Date.now() - batchStartedAt}ms — ${done.length}/${total}`,
      );
    }
    store.setSucceeded(jobId, new TextEncoder().encode(JSON.stringify({ blocks: done })));
    log(jobId, `done: ${total} blocks in ${Date.now() - startedAt}ms`);
  } catch (err) {
    outcome = "failed";
    const { code, message } = mapTranslateError(err);
    store.setFailed(jobId, { code, message });
    log(jobId, `failed (${code}) after ${Date.now() - startedAt}ms: ${message}`);
  } finally {
    recordJobEnd("translate", outcome, (Date.now() - startedAt) / 1000);
  }
}

function log(jobId: string, message: string): void {
  // Sidecar-side observability for the translate path (issue: "一直加载中" was
  // invisible — no logs). Short job id is enough to correlate poll requests.
  console.log(`[translate] job ${jobId.slice(0, 8)} ${message}`);
}

const WIKILINK = /\[\[([^\]|]+)(\|[^\]]*)?\]\]/g;

/** Force every wikilink target in the translated block back to the source
 *  block's targets (matched by order), keeping the model's translated label.
 *  Guarantees navigation integrity even if the model rewrote or dropped a
 *  target — the visible label may be translated, the link destination is not.
 *  If the model emitted fewer/more wikilinks than the source, only the
 *  positionally-matched ones are re-pinned; extras are left untouched.
 *
 *  By-order matching assumes the model preserves intra-block link order. If a
 *  translation reorders two links within one block (e.g. Chinese clause order
 *  flips), their targets swap — an accepted tradeoff of the locked by-order
 *  design (label-matching would be far more fragile). */
export function repinWikilinks(src: string, tr: string): string {
  const srcTargets = Array.from(src.matchAll(WIKILINK), (m) => m[1]);
  if (srcTargets.length === 0) return tr;
  let k = 0;
  return tr.replace(WIKILINK, (whole, _target: string, labelPart?: string) => {
    if (k >= srcTargets.length) return whole;
    const target = srcTargets[k];
    k += 1;
    return labelPart ? `[[${target}${labelPart}]]` : `[[${target}]]`;
  });
}

interface MappedTranslateError {
  code: string;
  message: string;
}

function mapTranslateError(err: unknown): MappedTranslateError {
  if (err instanceof TranslatorClientError) {
    return { code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "translator_api", message };
}
