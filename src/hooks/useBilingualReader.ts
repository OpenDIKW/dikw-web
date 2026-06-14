import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BilingualBlock } from "../components/BilingualView";
import { splitMarkdownBlocks } from "../utils/markdown-blocks";
import { TranslateError, translateBlocks, type TranslateCache } from "../utils/translate";

interface UseBilingualReaderOptions {
  /** Frontmatter-stripped markdown to read (same content the mono view renders). */
  body: string;
  /** Whether the sidecar translator is configured; gates whether translation runs. */
  enabled: boolean;
  targetLang?: string;
  /** IndexedDB-backed cache (or a test shim); null/undefined → no caching. */
  cache?: TranslateCache | null;
  /** Override for tests. */
  translate?: typeof translateBlocks;
}

export interface BilingualReader {
  /** Toggle is ON (the dual-column view should render). */
  active: boolean;
  /** A chunked translation is in flight; batches stream in and fill `blocks`
   *  progressively until the final result lands. */
  translating: boolean;
  /** The translation came back from cache (drives the "cached" chip). */
  cached: boolean;
  error: TranslateError | null;
  /** Ordered blocks with translations filled in (undefined until they arrive). */
  blocks: BilingualBlock[];
  toggle: () => void;
  retranslate: () => void;
  /** Re-translate, bypassing the cache (force fresh). */
  forceRetranslate: () => void;
  cancel: () => void;
}

/**
 * Drives the Base reader's bilingual mode for one page: splits the body into
 * blocks, sends the text blocks to /web/translate, and maps the result back
 * 1:1. The translation is chunked server-side, so partial batches arrive via
 * `onProgress` and fill the columns progressively; the final result then
 * overwrites them. Resets when the body changes; aborts in-flight work on
 * cancel / page switch.
 */
export function useBilingualReader({
  body,
  enabled,
  targetLang,
  cache,
  translate = translateBlocks,
}: UseBilingualReaderOptions): BilingualReader {
  const [active, setActive] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<TranslateError | null>(null);
  const [translations, setTranslations] = useState<string[] | null>(null);
  // Progressive reveal buffer: filled as batches arrive (sparse — `undefined`
  // slots still show a skeleton). The complete `translations` takes precedence
  // once the job finishes; this is cleared on reset/cancel.
  const [partial, setPartial] = useState<(string | undefined)[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const blocks = useMemo(() => splitMarkdownBlocks(body), [body]);
  const textBlocks = useMemo(
    () => blocks.filter((b) => b.kind === "text").map((b) => b.md),
    [blocks],
  );

  const run = useCallback(
    (refresh = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runIdRef.current;
      setTranslating(true);
      setError(null);
      setCached(false);
      setPartial(null);
      void translate(textBlocks, {
        targetLang,
        signal: controller.signal,
        cache,
        refresh,
        onProgress: (e) => {
          if (runIdRef.current !== runId) return;
          if (e.phase === "cache_hit") {
            setCached(true);
          } else if (e.phase === "partial") {
            setPartial((prev) => {
              const next = prev
                ? prev.slice()
                : new Array<string | undefined>(textBlocks.length).fill(undefined);
              for (const { i, tr } of e.blocks) {
                if (i >= 0 && i < next.length) next[i] = tr;
              }
              return next;
            });
          }
        },
      })
        .then((result) => {
          if (runIdRef.current !== runId) return;
          setTranslations(result);
          setTranslating(false);
        })
        .catch((err: unknown) => {
          if (runIdRef.current !== runId) return;
          // Abort is intentional (cancel / page switch) — leave state to the caller.
          if (err instanceof TranslateError && err.code === "aborted") return;
          setError(
            err instanceof TranslateError
              ? err
              : new TranslateError(
                  "translator_api",
                  err instanceof Error ? err.message : String(err),
                ),
          );
          setTranslating(false);
        });
    },
    [textBlocks, targetLang, cache, translate],
  );

  // Reset everything when the page body changes — a new document starts in the
  // single-column (mono) view, and any in-flight translation is abandoned.
  useEffect(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setActive(false);
    setTranslating(false);
    setCached(false);
    setError(null);
    setTranslations(null);
    setPartial(null);
  }, [body]);

  // Stop any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = useCallback(() => {
    if (!enabled) return;
    if (active) {
      // Only hide the dual column — do NOT abort an in-flight translation.
      // Letting it run to completion fills `translations` and writes the cache,
      // so toggling back shows the finished (or still-streaming) result instead
      // of discarding the work and re-translating from scratch on every click.
      setActive(false);
      return;
    }
    setActive(true);
    // Start a translation only when one isn't already done or in flight for this
    // page (so toggling back mid-translation doesn't kick off a second run).
    if (!translations && !translating) run();
  }, [enabled, active, translations, translating, run]);

  const retranslate = useCallback(() => {
    if (!enabled) return;
    run();
  }, [enabled, run]);

  // Like retranslate, but bypasses the cache read so it always re-translates
  // (the reader's "再翻译一次" action). The fresh result overwrites the cache.
  const forceRetranslate = useCallback(() => {
    if (!enabled) return;
    run(true);
  }, [enabled, run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current += 1;
    setActive(false);
    setTranslating(false);
    setPartial(null);
  }, []);

  const biBlocks = useMemo<BilingualBlock[]>(() => {
    // The complete result wins; until it lands, fall back to the progressive
    // partial buffer so already-translated paragraphs show while the rest load.
    const source = translations ?? partial;
    let textIndex = 0;
    return blocks.map((block) => {
      if (block.kind === "special") {
        return { kind: "special", source: block.md };
      }
      const translation = source ? source[textIndex] : undefined;
      textIndex += 1;
      return { kind: "text", source: block.md, translation };
    });
  }, [blocks, translations, partial]);

  return {
    active,
    translating,
    cached,
    error,
    blocks: biBlocks,
    toggle,
    retranslate,
    forceRetranslate,
    cancel,
  };
}
