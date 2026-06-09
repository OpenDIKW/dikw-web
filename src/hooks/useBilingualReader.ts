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
  /** The single whole-document translation request is in flight. */
  translating: boolean;
  /** The translation came back from cache (drives the "cached" chip). */
  cached: boolean;
  error: TranslateError | null;
  /** Ordered blocks with translations filled in (undefined until they arrive). */
  blocks: BilingualBlock[];
  toggle: () => void;
  retranslate: () => void;
  cancel: () => void;
}

/**
 * Drives the Base reader's bilingual mode for one page: splits the body into
 * blocks, sends the text blocks to /web/translate as a single request, and maps
 * the result back 1:1. Resets when the body changes; aborts in-flight work on
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
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const blocks = useMemo(() => splitMarkdownBlocks(body), [body]);
  const textBlocks = useMemo(
    () => blocks.filter((b) => b.kind === "text").map((b) => b.md),
    [blocks],
  );

  const run = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = ++runIdRef.current;
    setTranslating(true);
    setError(null);
    setCached(false);
    void translate(textBlocks, {
      targetLang,
      signal: controller.signal,
      cache,
      onProgress: (e) => {
        if (e.phase === "cache_hit" && runIdRef.current === runId) {
          setCached(true);
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
  }, [textBlocks, targetLang, cache, translate]);

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
  }, [body]);

  // Stop any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = useCallback(() => {
    if (!enabled) return;
    setActive((wasActive) => {
      if (wasActive) {
        abortRef.current?.abort();
        runIdRef.current += 1;
        setTranslating(false);
        return false;
      }
      if (!translations) run();
      return true;
    });
  }, [enabled, translations, run]);

  const retranslate = useCallback(() => {
    if (!enabled) return;
    run();
  }, [enabled, run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current += 1;
    setActive(false);
    setTranslating(false);
  }, []);

  const biBlocks = useMemo<BilingualBlock[]>(() => {
    let textIndex = 0;
    return blocks.map((block) => {
      if (block.kind === "special") {
        return { kind: "special", source: block.md };
      }
      const translation = translations ? translations[textIndex] : undefined;
      textIndex += 1;
      return { kind: "text", source: block.md, translation };
    });
  }, [blocks, translations]);

  return { active, translating, cached, error, blocks: biBlocks, toggle, retranslate, cancel };
}
