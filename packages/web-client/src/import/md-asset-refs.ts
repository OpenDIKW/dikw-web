// Mirrors dikw-core/src/dikw_core/md_inspect.py {_IMG_MD, _IMG_WIKILINK,
// _is_remote, _resolve_local}. The web importer must agree byte-for-byte
// on which paths are picked up — divergence shows up as missing assets
// after import.

import { scanWikilinks } from "../document/wikilink-scan.js";

export interface AssetRef {
  originalPath: string;
  alt: string;
  start: number;
  end: number;
  syntax: "markdown" | "wikilink";
}

export function extractAssetRefs(body: string): AssetRef[] {
  const refs: AssetRef[] = [];
  const scanDestination = destinationScanner(body);
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf("![", cursor);
    if (start < 0) break;
    const labelEnd = body.indexOf("]", start + 2);
    if (labelEnd < 0) break;
    // All openers before this ']' share the same destination. If it is invalid,
    // skip the group rather than retrying the same tail for every nested '!['.
    const destination = body[labelEnd + 1] === "(" ? scanDestination(labelEnd + 2) : null;
    cursor = destination?.end ?? labelEnd + 1;
    if (!destination) continue;
    refs.push({
      originalPath: destination.path,
      alt: body.slice(start + 2, labelEnd),
      start,
      end: destination.end,
      syntax: "markdown",
    });
  }
  for (const link of scanWikilinks(body, true)) {
    refs.push({
      originalPath: link.target,
      alt: link.label ?? "",
      start: link.start,
      end: link.end,
      syntax: "wikilink",
    });
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
}

function destinationScanner(body: string) {
  // Index possible endings once. Distinct '](' openers can otherwise retry the
  // same unterminated path/title suffix, even without a backtracking regex.
  const stops = Array.from(body.matchAll(/[)\n]/g), (match) => match.index);
  const quotes = Array.from(body.matchAll(/["\n]/g));
  const titles: { pathEnd: number; end: number }[] = [];
  for (let i = 0; i + 1 < quotes.length; i++) {
    const quote = quotes[i];
    const close = quotes[i + 1];
    if (quote[0] !== '"' || close[0] !== '"') continue;
    let pathEnd = quote.index;
    while (pathEnd > 0 && /\s/.test(body[pathEnd - 1])) pathEnd--;
    if (pathEnd === quote.index) continue;
    let end = close.index + 1;
    while (/\s/.test(body[end] ?? "")) end++;
    if (body[end] === ")") titles.push({ pathEnd, end: end + 1 });
  }
  let stopIndex = 0;
  let titleIndex = 0;
  let whitespaceStop = -1;
  let whitespaceEnd = -1;
  return (start: number): { path: string; end: number } | null => {
    let pathStart = start;
    while (/\s/.test(body[pathStart] ?? "")) pathStart++;
    if (body[pathStart] === ")" && pathStart > start) {
      // Core's legacy grammar accepts a single whitespace path (except LF).
      let last = pathStart - 1;
      while (last >= start && body[last] === "\n") last--;
      return last < start ? null : { path: body[last], end: pathStart + 1 };
    }
    while (stopIndex < stops.length && stops[stopIndex] < pathStart) stopIndex++;
    while (titleIndex < titles.length && titles[titleIndex].pathEnd <= pathStart) titleIndex++;
    const stop = stops[stopIndex] ?? body.length;
    const title = titles[titleIndex];
    if (title && title.pathEnd <= stop)
      return { path: body.slice(pathStart, title.pathEnd), end: title.end };
    if (body[stop] === "\n") {
      if (whitespaceStop !== stop) {
        whitespaceStop = stop;
        whitespaceEnd = stop;
        while (/\s/.test(body[whitespaceEnd] ?? "")) whitespaceEnd++;
      }
      if (body[whitespaceEnd] === ")")
        return { path: body.slice(pathStart, stop).trimEnd(), end: whitespaceEnd + 1 };
    }
    if (body[stop] !== ")" || stop === pathStart) return null;
    return { path: body.slice(pathStart, stop).trimEnd(), end: stop + 1 };
  };
}

const REMOTE_SCHEMES = /^([a-zA-Z][a-zA-Z0-9+\-.]*):/;

export function isRemoteRef(originalPath: string): boolean {
  const m = originalPath.match(REMOTE_SCHEMES);
  if (!m) return false;
  // ``file:`` is treated as local in core; mirror that.
  return m[1].toLowerCase() !== "file";
}

/** Strip a YAML front-matter block (``---`` ... ``---``) off the body.
 * Web side doesn't parse the YAML — we only need the body for asset extraction.
 * If the front-matter block is unterminated we leave the text alone. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  // Match the opening ``---`` line, then anything up to the next ``---`` line.
  const re = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = text.match(re);
  if (!m) return text;
  return text.slice(m[0].length);
}

/** POSIX-style join + normalize (handles ``..`` and ``.``, keeps no leading slash). */
export function posixJoinNormalize(base: string, rel: string): string {
  const parts = (base ? base.split("/") : []).concat(rel.split(/[\\/]/));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) {
        // Escapes the root — return a sentinel the caller can reject.
        out.push("..");
      } else if (out[out.length - 1] === "..") {
        out.push("..");
      } else {
        out.pop();
      }
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export interface ResolveContext {
  /** POSIX-style path of the source md file, relative to the project root
   * (e.g. ``notes/foo.md``). The directory portion is the "sibling" base. */
  mdRelPath: string;
  /** Set of every selected file's POSIX-relative path under the project root. */
  available: ReadonlySet<string>;
}

/** Sibling-of-md → project-root two-stage lookup, mirroring core's _resolve_local.
 *  Returns the POSIX-relative path under project root that the reference points at,
 *  or null if neither candidate exists in ``available``. Remote refs and refs that
 *  escape the project root return null and are treated as missing by the caller. */
export function resolveAssetRef(originalPath: string, ctx: ResolveContext): string | null {
  if (isRemoteRef(originalPath)) return null;
  if (originalPath.startsWith("/")) return null;
  const lastSlash = ctx.mdRelPath.lastIndexOf("/");
  const mdDir = lastSlash >= 0 ? ctx.mdRelPath.slice(0, lastSlash) : "";

  const candidates = [
    posixJoinNormalize(mdDir, originalPath),
    posixJoinNormalize("", originalPath),
  ];
  for (const cand of candidates) {
    if (cand.startsWith("..")) continue;
    if (ctx.available.has(cand)) return cand;
  }
  return null;
}
