// Detached runner for /web/translate jobs (mirrors http.ts `runConversion`).
// Runs the LLM translation off the request lifetime, re-pins wikilink targets
// defensively, and stores the block-aligned result as JSON bytes on the job.

import type { JobStore } from "./jobStore.js";
import { TranslatorClient, TranslatorClientError } from "./translatorClient.js";

export interface TranslateRunArgs {
  client: TranslatorClient;
  blocks: string[];
  targetLang: string;
}

/** The translation pipeline, detached from any HTTP request. Stores the
 *  block-aligned JSON on success and a mapped error code on any failure. MUST
 *  NOT let a rejection escape this `void`-ed promise. */
export async function runTranslation(
  store: JobStore,
  jobId: string,
  args: TranslateRunArgs,
): Promise<void> {
  try {
    store.setRunning(jobId);
    const translated = await args.client.translate(args.blocks, args.targetLang);
    const blocks = translated.map((tr, i) => ({ i, tr: repinWikilinks(args.blocks[i], tr) }));
    const json = JSON.stringify({ blocks });
    store.setSucceeded(jobId, new TextEncoder().encode(json));
  } catch (err) {
    const { code, message } = mapTranslateError(err);
    store.setFailed(jobId, { code, message });
  }
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
