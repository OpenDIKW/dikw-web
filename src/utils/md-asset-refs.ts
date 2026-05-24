// Mirrors dikw-core/src/dikw_core/md_inspect.py {_IMG_MD, _IMG_WIKILINK,
// _is_remote, _resolve_local}. The web importer must agree byte-for-byte
// on which paths are picked up — divergence shows up as missing assets
// after import.

export interface AssetRef {
  originalPath: string;
  alt: string;
  start: number;
  end: number;
  syntax: "markdown" | "wikilink";
}

const STANDARD_IMG_RE = /!\[([^\]]*)\]\(\s*([^)\n]+?)(?=\s+"[^"\n]*"\s*\)|\s*\))(?:\s+"[^"\n]*")?\s*\)/g;
const WIKILINK_IMG_RE = /!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

export function extractAssetRefs(body: string): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const m of body.matchAll(STANDARD_IMG_RE)) {
    refs.push({
      originalPath: m[2],
      alt: m[1] ?? "",
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      syntax: "markdown"
    });
  }
  for (const m of body.matchAll(WIKILINK_IMG_RE)) {
    refs.push({
      originalPath: m[1],
      alt: m[2] ?? "",
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      syntax: "wikilink"
    });
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
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
export function resolveAssetRef(
  originalPath: string,
  ctx: ResolveContext
): string | null {
  if (isRemoteRef(originalPath)) return null;
  if (originalPath.startsWith("/")) return null;
  const lastSlash = ctx.mdRelPath.lastIndexOf("/");
  const mdDir = lastSlash >= 0 ? ctx.mdRelPath.slice(0, lastSlash) : "";

  const candidates = [
    posixJoinNormalize(mdDir, originalPath),
    posixJoinNormalize("", originalPath)
  ];
  for (const cand of candidates) {
    if (cand.startsWith("..")) continue;
    if (ctx.available.has(cand)) return cand;
  }
  return null;
}
