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
// Markdown inline link: [text](url). The URL allows one level of balanced
// parens (e.g. `https://example.com/path(v2)`) — deeper nesting is too rare
// to chase with a non-recursive regex.
const MARKDOWN_LINK_PATTERN = /\[(?:\\\]|[^\]\n])+?\]\((?:\\\)|\([^()\n]*\)|[^()\n])+?\)/g;
// Reference-style links: [text][label] (full) and [text][] (collapsed).
// Shortcut form `[label]` overlaps with stray bracketed text and needs the
// definition table to disambiguate — we only protect the explicit two-bracket
// forms here.
const REFERENCE_LINK_PATTERN = /\[(?:\\\]|[^\]\n])+?\]\[(?:\\\]|[^\]\n])*\]/g;
// Link reference definition: `[label]: url`. Must start on its own line with
// 0-3 spaces of indent. Multi-line title definitions are not protected (rare
// in source notes).
const LINK_DEFINITION_PATTERN = /^ {0,3}\[(?:\\\]|[^\]\n])+?\]:[ \t]+[^\n]+$/gm;

interface ProtectedRange {
  start: number;
  end: number;
}

/**
 * CommonMark fenced code scanner. Recognizes:
 * - 0-3 leading spaces on the opener and closer
 * - Backtick or tilde runs of length ≥3
 * - Closing fence of the same character, length ≥ opener, optional trailing whitespace
 * - Unclosed fence at EOF (CommonMark treats the rest of the document as the block)
 *
 * Implemented as a line scanner because nested-fence semantics and length
 * comparison (≥ opener) don't fit cleanly into a single regex.
 */
function collectFencedCodeRanges(body: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const lines = body.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // +1 for the \n separator
  }

  let i = 0;
  while (i < lines.length) {
    const opener = /^( {0,3})(`{3,}|~{3,})/.exec(lines[i]);
    if (!opener) {
      i++;
      continue;
    }
    const fenceChar = opener[2][0];
    const fenceLen = opener[2].length;
    const closingRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closingRe.test(lines[j])) {
      j++;
    }
    const startPos = lineStarts[i];
    let endPos: number;
    if (j < lines.length) {
      // Include the closing line and its trailing newline if present.
      endPos = lineStarts[j] + lines[j].length;
      if (endPos < body.length && body[endPos] === "\n") endPos++;
    } else {
      endPos = body.length;
    }
    ranges.push({ start: startPos, end: endPos });
    i = j + 1;
  }
  return ranges;
}

function collectProtectedRanges(body: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];

  const fm = FRONTMATTER_PATTERN.exec(body);
  if (fm) {
    ranges.push({ start: 0, end: fm[0].length });
  }

  ranges.push(...collectFencedCodeRanges(body));

  let m: RegExpExecArray | null;
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

  const refLinks = new RegExp(REFERENCE_LINK_PATTERN.source, REFERENCE_LINK_PATTERN.flags);
  while ((m = refLinks.exec(body)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }

  const linkDefs = new RegExp(LINK_DEFINITION_PATTERN.source, LINK_DEFINITION_PATTERN.flags);
  while ((m = linkDefs.exec(body)) !== null) {
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
  // Normalize line endings before range collection — line-oriented recognizers
  // (frontmatter, fenced code, indented code, display math) expect LF. The
  // enhanced output also uses LF; the Source tab still shows the original
  // page.body so CRLF preservation isn't required downstream.
  const normalized = body.replace(/\r\n/g, "\n");
  const segments: Segment[] = sliceByRanges(normalized, collectProtectedRanges(normalized));
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
