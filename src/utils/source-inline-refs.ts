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

/**
 * Source 层 read tab 渲染前的预处理:对每个 ref 的 title 在 body 中首次
 * 字面出现的位置,合成 `[[title|原文本]]` wikilink 标记。产物丢回 markdown-it
 * 由现有 wikilink rule 渲染为可点击 inline-wikilink 按钮。
 *
 * 当前实现:segment-based scan,case-insensitive,ASCII 要求 word boundary
 * CJK 无 boundary,最小长度英文 ≥3 / CJK ≥2,长 title 优先,已替换段
 * 标记 protected 不复扫 — 受保护区段(frontmatter / code / math / raw HTML /
 * existing wikilink / markdown link)在后续任务加。
 */
export function injectInlineRefs(
  body: string,
  refs: ReadonlyArray<InlineRefMatch>
): InjectInlineRefsResult {
  const matchedPaths = new Set<string>();
  const segments: Segment[] = [{ kind: "plain", text: body }];
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
