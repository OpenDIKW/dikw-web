import { useEffect, useState } from "react";
import { translateBlocks, type TranslateCache } from "../utils/translate";

interface UsePreviewTranslationOptions {
  /** Fire only when warranted (translated-column click on an English target —
   *  the caller decides). Disabled → the originals pass through untouched. */
  enabled: boolean;
  title: string;
  summary: string;
  cache: TranslateCache | null;
}

export interface PreviewTranslation {
  /** Translated title / summary, or null while pending, disabled, or failed. */
  title: string | null;
  summary: string | null;
  /** True once the translated pair is showing (drives the AI badge). */
  translated: boolean;
}

// NUL separator — unambiguous even when the title itself contains spaces.
const keyOf = (title: string, summary: string) => `${title}\u0000${summary}`;

/**
 * Translates a wikilink-preview card's title + summary via /web/translate (two
 * tiny blocks, shared IndexedDB cache, so a revisited card is instant). The
 * original text shows until the translation lands; any failure falls back
 * silently — the card is an enhancement, not a load-bearing surface.
 */
export function usePreviewTranslation({
  enabled,
  title,
  summary,
  cache,
}: UsePreviewTranslationOptions): PreviewTranslation {
  // `result.key` ties a result to the inputs that produced it, so a
  // late-resolving translation for a previous card never bleeds into this one.
  const [result, setResult] = useState<{ key: string; title: string; summary: string } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void translateBlocks([title, summary], {
      cache: cache ?? undefined,
      signal: controller.signal,
    })
      .then(([trTitle, trSummary]) => {
        // A non-empty source block that came back empty is a dropped/failed
        // translation — fall back to the originals (no AI badge) rather than show a
        // half-translated card. (`title` is always a non-empty input; `summary`
        // may legitimately be empty, so only a non-empty summary must translate.)
        if (!trTitle?.trim() || (summary.trim() && !trSummary?.trim())) return;
        setResult({ key: keyOf(title, summary), title: trTitle ?? "", summary: trSummary ?? "" });
      })
      .catch(() => {
        // Silent fallback to the original text.
      });
    return () => controller.abort();
  }, [enabled, title, summary, cache]);

  const fresh = enabled && result && result.key === keyOf(title, summary) ? result : null;
  return {
    title: fresh ? fresh.title : null,
    summary: fresh ? fresh.summary : null,
    translated: fresh !== null,
  };
}
