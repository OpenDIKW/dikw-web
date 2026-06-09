// Heuristic page-language detection for the Base reader's bilingual toggle.
// An article's language isn't known before fetch, so the reader calls this
// AFTER render to decide whether to offer the EN→中 "AI 翻译" toggle at all.

/** True when `body` reads as English: CJK ideographs are < 15% of all letters
 *  (Latin + CJK). Mirrors the mockup's `pageIsEnglish`. A body with no letters
 *  at all is not considered English, so empty / symbol-only pages show no
 *  toggle. Markdown syntax characters aren't letters, so they don't skew it. */
export function isEnglishBody(body: string): boolean {
  const cjk = (body.match(/[一-鿿]/g) ?? []).length;
  const latin = (body.match(/[A-Za-z]/g) ?? []).length;
  const letters = cjk + latin;
  if (letters === 0) return false;
  return cjk / letters < 0.15;
}
