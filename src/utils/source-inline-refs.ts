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
 * 当前实现:segment-based scan,case-insensitive,ASCII 要求 word boundary
 * CJK 无 boundary,最小长度英文 ≥3 / CJK ≥2,长 title 优先,已替换段
 * 标记 protected 不复扫 — 已识别受保护区段:frontmatter / fenced & indented
 * code(含 mermaid)/ math(inline + display)/ inline code;raw HTML / wikilink
 * / markdown link 在后续任务加。
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
    if (injectOneRef(segments, ref)) {
      matchedPaths.add(ref.path);
    }
  }
  return { body: segments.map((s) => s.text).join(""), matchedPaths };
}
