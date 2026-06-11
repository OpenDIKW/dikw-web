// Normalize a source filename into a Unicode kebab-case stem at import time.
// ASCII is lowercased; runs of non-letter / non-number characters (spaces, ``_``,
// punctuation, hyphen variants like U+2010) collapse to a single ``-``; letters
// (including Han) and digits survive. The stem is capped by code point so the
// resulting ``<stem>.md`` filename stays well under 32 code points.
// See docs/adr/0004-source-import-normalization.md.

const MAX_STEM = 28;

/** Kebab-case the stem (basename without its final extension), capped at
 *  ``maxStem`` code points. Never returns an empty string. */
export function kebabStem(name: string, maxStem = MAX_STEM): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot < 0 ? base : base.slice(0, dot);
  const kebab = stem
    .normalize("NFC")
    .toLowerCase()
    // A maximal run of non-letter/non-number chars becomes one hyphen, so no
    // ``--`` can survive; letters (incl. Han), digits, and combining marks
    // (``\p{M}`` — kept so a base+mark sequence with no precomposed form isn't
    // fractured by a hyphen) are kept verbatim.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // Cap by code point (``Array.from`` never splits a surrogate pair), then
  // re-trim any trailing hyphen the cut exposed.
  const capped = Array.from(kebab).slice(0, maxStem).join("").replace(/-+$/g, "");
  return capped || "untitled";
}

/** Kebab-case a source filename and force the ``.md`` extension. */
export function kebabSourceName(name: string): string {
  return `${kebabStem(name)}.md`;
}
