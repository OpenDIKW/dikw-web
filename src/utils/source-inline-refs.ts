export interface InlineRefMatch {
  path: string;
  title: string;
}

export interface InjectInlineRefsResult {
  body: string;
  matchedPaths: Set<string>;
}

/**
 * Source 层 read tab 渲染前的预处理:对每个 ref 的 title 在 body 中首次
 * 字面出现的位置,合成 `[[title|原文本]]` wikilink 标记。产物丢回 markdown-it
 * 由现有 wikilink rule 渲染为可点击 inline-wikilink 按钮。
 *
 * 当前实现:简单 substring 查找,无大小写/边界/受保护区域支持 — 后续任务
 * 逐步加上。
 */
export function injectInlineRefs(
  body: string,
  refs: ReadonlyArray<InlineRefMatch>
): InjectInlineRefsResult {
  const matchedPaths = new Set<string>();
  let current = body;
  for (const ref of refs) {
    const index = current.indexOf(ref.title);
    if (index < 0) {
      continue;
    }
    const before = current.slice(0, index);
    const matched = current.slice(index, index + ref.title.length);
    const after = current.slice(index + ref.title.length);
    current = `${before}[[${ref.title}|${matched}]]${after}`;
    matchedPaths.add(ref.path);
  }
  return { body: current, matchedPaths };
}
