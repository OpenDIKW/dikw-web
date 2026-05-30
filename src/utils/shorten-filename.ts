// Shorten an over-long filename before it is handed to MinerU. MinerU.net
// errors on very long names (especially long non-ASCII ones), so we cap the
// stem while preserving the extension (MinerU keys format detection off it)
// and the original text (Chinese/Unicode is kept, just truncated).

/** Truncate the stem (basename without extension) to maxStem code points,
 *  preserving the extension and any non-ASCII characters. Returns the basename
 *  (any leading directory is dropped). */
export function shortenFileName(name: string, maxStem = 25): string {
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot < 0 ? base : base.slice(0, dot);
  const ext = dot < 0 ? "" : base.slice(dot);
  const chars = Array.from(stem); // code points → never split a surrogate pair
  if (chars.length <= maxStem) return base;
  return chars.slice(0, maxStem).join("") + ext;
}
