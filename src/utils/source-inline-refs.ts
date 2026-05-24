export interface InlineRefMatch {
  path: string;
  title: string;
}

export interface InjectInlineRefsResult {
  body: string;
  matchedPaths: Set<string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAscii(value: string): boolean {
  return /[A-Za-z0-9_]/.test(value);
}

function buildTitlePattern(title: string): RegExp {
  const escaped = escapeRegExp(title);
  // ASCII title → both sides need a word boundary;
  // CJK / 全符号 title → 不要求 boundary(后续任务覆盖)。
  if (hasAscii(title)) {
    return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "iu");
  }
  return new RegExp(escaped, "iu");
}

/**
 * Source 层 read tab 渲染前的预处理:对每个 ref 的 title 在 body 中首次
 * 字面出现的位置,合成 `[[title|原文本]]` wikilink 标记。产物丢回 markdown-it
 * 由现有 wikilink rule 渲染为可点击 inline-wikilink 按钮。
 *
 * 当前实现:case-insensitive 正则查找,ASCII title 要求 word boundary,
 * 保留 source 侧原文字面 — segment 模型 / 长度阈值 / 受保护区段在后续任务加。
 */
export function injectInlineRefs(
  body: string,
  refs: ReadonlyArray<InlineRefMatch>
): InjectInlineRefsResult {
  const matchedPaths = new Set<string>();
  let current = body;
  for (const ref of refs) {
    const pattern = buildTitlePattern(ref.title);
    const match = pattern.exec(current);
    if (!match) {
      continue;
    }
    const index = match.index;
    const literal = match[0];
    const before = current.slice(0, index);
    const after = current.slice(index + literal.length);
    current = `${before}[[${ref.title}|${literal}]]${after}`;
    matchedPaths.add(ref.path);
  }
  return { body: current, matchedPaths };
}
