export interface InlineRefMatch {
  path: string;
  title: string;
}

export interface InjectInlineRefsResult {
  body: string;
  matchedPaths: Set<string>;
}

type Segment = { kind: "plain" | "protected"; text: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAscii(value: string): boolean {
  return /[A-Za-z0-9_]/.test(value);
}

function meetsMinLength(title: string): boolean {
  // ASCII-bearing titles need ≥3 chars; CJK / pure-symbol titles need ≥2.
  const minLen = hasAscii(title) ? 3 : 2;
  return title.length >= minLen;
}

function buildTitlePattern(title: string): RegExp {
  const escaped = escapeRegExp(title);
  if (hasAscii(title)) {
    return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "iu");
  }
  return new RegExp(escaped, "iu");
}

/** Sort by title length desc, so longer titles win when they share a prefix. */
function sortRefsLongestFirst(refs: ReadonlyArray<InlineRefMatch>): InlineRefMatch[] {
  return [...refs].sort((a, b) => b.title.length - a.title.length);
}

/** Try to inject ONE ref's first occurrence into the plain segments only. */
function injectOneRef(segments: Segment[], ref: InlineRefMatch): boolean {
  const pattern = buildTitlePattern(ref.title);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind !== "plain") {
      continue;
    }
    const match = pattern.exec(seg.text);
    if (!match) {
      continue;
    }
    const index = match.index;
    const literal = match[0];
    const before = seg.text.slice(0, index);
    const after = seg.text.slice(index + literal.length);
    const wrapped: Segment = { kind: "protected", text: `[[${ref.title}|${literal}]]` };
    const replacement: Segment[] = [];
    if (before) replacement.push({ kind: "plain", text: before });
    replacement.push(wrapped);
    if (after) replacement.push({ kind: "plain", text: after });
    segments.splice(i, 1, ...replacement);
    return true;
  }
  return false;
}

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const FENCED_CODE_PATTERN = /(^|\n)(?<fence>```|~~~)[^\n]*\n[\s\S]*?\n\k<fence>(?=\n|$)/g;
// Indented code: a sequence of one-or-more lines starting with 4 spaces,
// preceded by a blank line (or BOS). Simplified to "at least 4 leading
// spaces on a fresh paragraph line."
const INDENTED_CODE_PATTERN = /(^|\n\n)((?:    [^\n]*(?:\n|$))+)/g;
const INLINE_CODE_PATTERN = /(`+)(?:.+?)\1/g;
const DISPLAY_MATH_PATTERN = /\$\$[\s\S]*?\$\$/g;
// Inline math: opening $ must not be preceded by '\' and not followed by '$';
// closing $ must not be preceded by '\'. Content single-line.
const INLINE_MATH_PATTERN = /(?<!\\)\$(?!\$)((?:\\\$|[^\n$])+?)(?<!\\)\$/g;
// Raw HTML block: a `<tag ...>...</tag>` span where tag is a known block tag.
// Conservative whitelist matching the markdown reader's sanitizer scope.
const RAW_HTML_BLOCK_PATTERN = /<(details|table|summary|div|section|article|aside|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Existing wikilink (with optional image bang) — must NOT be wrapped again.
const EXISTING_WIKILINK_PATTERN = /!?\[\[[^\]\n]+?\]\]/g;
// Markdown link: [text](url). Bracket part may contain ] only if escaped — accept simple form.
const MARKDOWN_LINK_PATTERN = /\[(?:\\\]|[^\]\n])+?\]\((?:\\\)|[^)\n])+?\)/g;

interface ProtectedRange {
  start: number;
  end: number;
}

function collectProtectedRanges(body: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];

  const fm = FRONTMATTER_PATTERN.exec(body);
  if (fm) {
    ranges.push({ start: 0, end: fm[0].length });
  }

  let m: RegExpExecArray | null;
  const fence = new RegExp(FENCED_CODE_PATTERN.source, FENCED_CODE_PATTERN.flags);
  while ((m = fence.exec(body)) !== null) {
    // m[1] is the leading newline (or empty if BOS); fence proper starts after it.
    const lead = m[1] ? 1 : 0;
    ranges.push({ start: m.index + lead, end: m.index + m[0].length });
  }

  const indented = new RegExp(INDENTED_CODE_PATTERN.source, INDENTED_CODE_PATTERN.flags);
  while ((m = indented.exec(body)) !== null) {
    const lead = m[1].length;
    ranges.push({ start: m.index + lead, end: m.index + m[0].length });
  }

  const inlineCode = new RegExp(INLINE_CODE_PATTERN.source, INLINE_CODE_PATTERN.flags);
  while ((m = inlineCode.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const displayMath = new RegExp(DISPLAY_MATH_PATTERN.source, DISPLAY_MATH_PATTERN.flags);
  while ((m = displayMath.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const inlineMath = new RegExp(INLINE_MATH_PATTERN.source, INLINE_MATH_PATTERN.flags);
  while ((m = inlineMath.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const rawHtml = new RegExp(RAW_HTML_BLOCK_PATTERN.source, RAW_HTML_BLOCK_PATTERN.flags);
  while ((m = rawHtml.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const wikilinks = new RegExp(EXISTING_WIKILINK_PATTERN.source, EXISTING_WIKILINK_PATTERN.flags);
  while ((m = wikilinks.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const mdLinks = new RegExp(MARKDOWN_LINK_PATTERN.source, MARKDOWN_LINK_PATTERN.flags);
  while ((m = mdLinks.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  return mergeRanges(ranges);
}

function mergeRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  if (ranges.length <= 1) return ranges.slice().sort((a, b) => a.start - b.start);
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const merged: ProtectedRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function sliceByRanges(body: string, ranges: ProtectedRange[]): Segment[] {
  if (!ranges.length) return [{ kind: "plain", text: body }];
  const segs: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segs.push({ kind: "plain", text: body.slice(cursor, range.start) });
    }
    segs.push({ kind: "protected", text: body.slice(range.start, range.end) });
    cursor = range.end;
  }
  if (cursor < body.length) {
    segs.push({ kind: "plain", text: body.slice(cursor) });
  }
  return segs;
}

/**
 * Source 层 read tab 渲染前的预处理:对每个 ref 的 title 在 body 中首次
 * 字面出现的位置,合成 `[[title|原文本]]` wikilink 标记。产物丢回 markdown-it
 * 由现有 wikilink rule 渲染为可点击 inline-wikilink 按钮。
 *
 * 已识别受保护区段:frontmatter / fenced & indented code(含 mermaid)/
 * inline code / display + inline math / raw HTML 块(details/table/...) /
 * existing wikilink(含 image embed) / markdown link 整体。
 * Heading text 不算受保护 — 允许在 # heading 文本里命中。
 */
export function injectInlineRefs(
  body: string,
  refs: ReadonlyArray<InlineRefMatch>
): InjectInlineRefsResult {
  const matchedPaths = new Set<string>();
  const segments: Segment[] = sliceByRanges(body, collectProtectedRanges(body));
  for (const ref of sortRefsLongestFirst(refs)) {
    if (!meetsMinLength(ref.title)) {
      continue;
    }
    if (matchedPaths.has(ref.path)) {
      // Same path already injected via an earlier (possibly longer-title)
      // entry — skip duplicates so each K page gets at most one inline link.
      continue;
    }
    if (injectOneRef(segments, ref)) {
      matchedPaths.add(ref.path);
    }
  }
  return { body: segments.map((s) => s.text).join(""), matchedPaths };
}
