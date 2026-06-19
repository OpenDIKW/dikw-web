# 2. Source 正文动态嵌入 provenance wikilink

Source 层页面自身没有 `[[wikilink]]`,所有反向引用此前只能聚合在文档底部的
Linked references 面板里 — 阅读体验上 source 永远是孤立的纯文本块,而
wiki 页面有内联可点链接。本 ADR 把"已有反向边的 K 页"在 source 正文中
**首次出现**位置自动合成 wikilink,使 source 的阅读体验向 wiki 对齐;
未匹配上的 K 页留在底部 panel 兜底,信息不丢失。

## Status

Proposed (2026-05-24)。

## 背景

`ba3e165` 之后 source 页同时拉两条反向边:
- `GET /v1/base/pages/{path}/links?direction=in` — K 页正文 `[[source]]` wikilink
- `GET /v1/base/pages/{path}/provenance?direction=in` — K 页 frontmatter `sources:` 声明

两条边在 `mergeSourceReferences()` 里 union 后渲染为底部
`<WikiBacklinksSection>`,带 linked / sourced chip 标记。这种"外挂面板"形式
有两个问题:

1. **阅读心智割裂** — 读者得读完正文才知道哪些 K 页引用了什么,无法在
   阅读过程中即时跳转
2. **wiki vs source 体验不一致** — wiki 页的 `[[link]]` 是内联可点的,
   source 没有任何内联交互

## 决策

Source 层 read tab 渲染时,基于现有 `sourceReferences` (backlinks ∪ derived)
扫描 source body,**对每个 K 页 title 在 body 中首次字面出现的位置**,
将匹配文本替换为合成的 `[[title|原文本]]` wikilink 标记。增强后的 body
走现有 markdown-it pipeline,wikilink rule 会渲染为
`<button class="inline-wikilink" data-wiki-link="title">原文本</button>`,
click 一路走到现有 `previewDoc()` 通道,右侧弹 K 页 preview — **零新增
渲染代码**。

匹配不上的 K 页(title 在 body 中找不到合规位置)留在底部 panel 显示。
Panel 文案 **复用现有 `pages.wiki.linkedRefsTitle`,不新增 i18n key** —— inline
已经表达了"linked",底部 panel 视觉分工自然是"unlinked but still cited",
文字 key 不需要变(详见 §路由 决策 #4)。Source tab(raw view)始终用
未增强的 `page.body`。

### UX 锁定项

| 项 | 决策 |
| --- | --- |
| 候选 K 页范围 | `mergeSourceReferences(backlinks, derived)` 全集(linked + sourced 已合并) |
| 替换位置 | 每个 K 页**仅**首次出现位置 |
| 替换文本 | 保留 source 原文字面写法(不规范成 title);target 写 title |
| 大小写 | 不敏感 |
| 单词边界 | 英文要求 `\b` (含数字下划线); CJK 不要求 |
| 最小长度阈值 | 英文 ≥3 字符 / CJK ≥2 字符 |
| 多 K 页 title 互相包含 | longest-match-first(先排序后扫描) |
| Unmatched 兜底 | 底部 panel 仅列未匹配的 K 页 |
| Source tab | 用原始 `page.body`,不做替换 |

### 关键不变量

- **Read tab 与 source tab 的内容差异仅限合成 wikilink 注入**,不动文本/换行
- **同一 K 页在 inline + 底部 panel 中不同时出现**(matched ⊕ unmatched)
- **替换不进入受保护区域**(见 §跳过区域规范)
- **替换是渲染时纯函数**,不污染网络请求或缓存

## 拒绝的备选

- **顶部聚合 banner** — 把所有 K 页堆在文档顶,放弃 inline 精度。
  阅读体验上和"底部 panel 搬到顶部"差别不大,没体现"嵌入正文"的核心价值。
- **heading 锚点旁内联 chip** — 只对 `IncomingLink.anchor` 非空的反向边做内联,
  贴在对应 heading 下。实际数据里 anchored 边占比预期很小(多数 K 页写
  `[[source]]` 不带 anchor;frontmatter `sources:` 永远无 anchor),收益不抵
  实现复杂度。
- **嵌入式合成 wikilink 段落** — 在 source body 顶部插入一个 blockquote
  `> 本页被以下笔记引用: [[A]] · [[B]]`。简单但和顶部 banner 一样脱离正文
  上下文。
- **全局自动链接所有 K 页** (MediaWiki / Notion 风格) — 扫描 `pages.data` 全集
  做关键词匹配。召回高但噪音也高(K 页 title 撞上不相关字符串就会误链),
  且和"已知反向边"信号脱钩。
- **后处理渲染后的 HTML DOM** — 在 `MarkdownView` 的 effect 里 walk text node
  做替换。MarkdownView 已经背了 mermaid/chart/image 三个 DOM-mutation effect,
  再加一个互相干扰风险高(参见 `ba3e165` 修复的
  memoized-innerHTML bug);并且要重建一套"跳过 code / link / pre" 的 DOM
  级规则,而 markdown 源字符串扫描层已经有这些边界信息。

## 实现路径

### 数据流

```text
WikiPage
  ├─ sourceReferences = mergeSourceReferences(backlinks, derived)  ← 现有
  ├─ if (page.layer === "source"):
  │     { body: enhancedBody, matchedPaths } = injectInlineRefs(page.body, sourceReferences)
  │     unmatched = sourceReferences.filter(ref => !matchedPaths.has(ref.path))
  │  else:
  │     enhancedBody = page.body
  │     unmatched = []  // 非 source 层不渲染 backlinks panel
  ├─ <MarkdownView body={enhancedBody} ... />              ← read tab
  ├─ <WikiBacklinksSection references={unmatched} ... />   ← 仅 unmatched
  └─ <pre>{page.body}</pre>                                ← source tab,原始
```

### 新增工具 `injectInlineRefs(body, refs) → { body, matchedPaths }`

放在 `src/utils/source-inline-refs.ts`(新文件),纯函数 + 全套单测。

签名:

```ts
export interface InlineRefMatch {
  path: string;
  title: string;
}

export interface InjectInlineRefsResult {
  body: string;                     // 替换后的 markdown 源字符串
  matchedPaths: Set<string>;        // 已成功内联的 K 页 path
}

export function injectInlineRefs(
  body: string,
  refs: ReadonlyArray<InlineRefMatch>
): InjectInlineRefsResult;
```

算法:

1. **候选排序** — 按 `title.length` 降序排序 `refs`(longest-match-first),
   过滤掉低于最小长度阈值的 title:
   - 含 ASCII 字母/数字 → 阈值 3 字符
   - 全 CJK / 符号 → 阈值 2 字符
2. **区域切片** — 将 body 按"可替换"与"受保护"切成顺序段列表
   (见 §跳过区域规范),只在可替换段内做扫描。输入的 body 含 frontmatter
   (`page.body` 直传),frontmatter 整段作为首个 "protected" segment 原样
   保留在输出中 — MarkdownView 拿到增强 body 后会自己再做一次
   `parseMarkdownDocument` 去掉 frontmatter
3. **逐 ref 扫描** — 对每个 ref:
   - 构造正则: 英文用 `\b<escaped-title>\b` (不敏感 flag `iu`),CJK 用
     纯字符串包含查找
   - 在剩余可替换段内寻找首次出现位置,记录段内 offset
   - 命中: 把匹配文本替换为 `[[title|原文本]]`;`matchedPaths.add(path)`;
     将命中位置之后的尾部仍作为可替换继续供其他 ref 扫描;**已被替换段**
     标记为不可再被替换(避免在合成的 `[[...]]` 内部又触发匹配)
   - 未命中: 跳过,不进 `matchedPaths`
4. **拼回** — 顺序拼回所有段,得到增强 body

### 路由: WikiPage 改造

`src/pages/WikiPage.tsx`:

1. 在 `sourceReferences` useMemo 之后再加一个 useMemo `enhancedSourceBody`,
   始终返回 `{ body, matchedPaths }`(仅 `page.layer === "source"` 时调用
   `injectInlineRefs`;其余情况 body 回退为 `page.body`、matchedPaths 为空集)
2. WikiPage 通过 `<WikiReader enhancedBody={page?.layer === "source" ? enhancedSourceBody.body : undefined} />`
   下传增强 body,`WikiReader` 内部再渲染 `<MarkdownView body={enhancedBody ?? page.body} />`
3. `<WikiBacklinksSection references={...} />` 的 references prop 改为:
   - source 层: `sourceReferences.filter(r => !enhancedSourceBody.matchedPaths.has(r.path))`
   - 非 source 层: 保持 `sourceReferences`(实际上是空,因为非 source 不拉 backlinks)
4. WikiBacklinksSection 文案 — **决定:复用现有 `pages.wiki.linkedRefsTitle`,
   不新增 i18n key**。理由:inline 已经表达了"linked",底部 panel 自然变成
   "unlinked but still cited",视觉分工解释语义,文字 key 不需要变。
5. **Cache-lag 过滤** — `injectInlineRefs` 调用前先按 `pages.data` 路径表
   过滤 `sourceReferences`,只对 `pages.data` 里已存在的 ref 内联。原因:
   `resolveDerivedPages` 有 cache-lag 兜底(K 页刚 synth、`pages.data` 还没
   刷新时用 wire title 占位),但 inline 出去的 `[[title|literal]]` 经
   `findPageForTarget(title, pages.data)` 会查不到 → click 触发 not-found。
   `openBacklink` 自己有 path-based fallback,所以让 cache-lag ref 留在
   panel 而不是被内联,反而更可靠。

### 复用 wikilink 渲染管线

合成的 `[[title|原文本]]` 经现有 `installWikiLinks()` 规则渲染为
`<button class="inline-wikilink" data-wiki-link="title">原文本</button>`。
`findPageForTarget(title, pages.data)` 已经做了大小写归一化、`.md` 剥离、
token 子串匹配等,所以 target 写 title 就能正确解析回 K 页 doc 并触发
`previewDoc()`。零新增渲染代码,零新增 CSS。

**Wikilink 路由的 layer 偏好** — 合成的 `[[title|literal]]` 经现有
`findPageForTarget` 解析回 K 页。当 K 页 (wiki/wisdom) 和 source 同名(实际
项目里很常见,K 页常借用 source 标题做派生)时,旧逻辑用 `pages.find(...)`
按数组顺序返回首匹配 — 会让 inline-injected source-back-reference 自己
路由回 source 自身。`findPageForTarget` 改为对 exact-match 候选按 K > source
排序,确保 inline 合成的 wikilink 始终命中 K 页。该改动对手写 `[[xxx]]` 也
保持向后兼容(用户的意图通常也是 K 页)。

## 跳过区域规范

`injectInlineRefs` 必须把以下区域识别为"受保护",不在其中替换:

| 区域 | 识别规则 | 理由 |
| --- | --- | --- |
| YAML frontmatter | body 起始的 `---\n...\n---\n` 块 | 元数据非正文(实际上 WikiPage 传给 MarkdownView 的已经是 `parseMarkdownDocument` 后的 body,但 source 走的是 `page.body` 含 frontmatter,需就地处理) |
| Fenced code block | ``` ```...``` ``` / `~~~...~~~`,信息字符串和缩进对齐 | 代码片段字面意义 |
| Indented code block | 行首 4 空格(在前一空行后) | 同上 |
| Inline code | `` `...` `` 含转义 | 同上 |
| Math display | `$$...$$` 跨行块 | KaTeX 渲染区 |
| Math inline | `$...$` 同行(参考 `installMath` 规则) | 同上 |
| Mermaid fence | fenced code 中 lang=mermaid,已含在 fenced code 规则中 | |
| Raw HTML block | `<tag>...</tag>` 跨段块(参考 `rawDetailsPattern` / `rawTablePattern`) | 渲染时走 sanitizer,字面不可拆 |
| Existing wikilink | `[[...]]` 整个区域(含 alias `[[a|b]]` 和 image `![[...]]`) | 已经是 link,不再二次包装 |
| Markdown link URL | `[text](url)` 中的 `(url)` 部分 | 链接目标是 URL 字面 |
| Markdown link text | `[text](url)` 中的 `[text]` 部分 | **允许**替换(text 是正文),但替换后变成 `[<button>...</button>](url)` 嵌套 — 风险:markdown-it 不会把 `[...]` 中的 wikilink 当成合法 link text。**决策:link text 也归为受保护**,放弃这类位置的命中(罕见,值得换简单) |
| Heading text | `# text` 中的 text | **允许**替换 — wikilink button 在 heading 里能正常工作。但 heading id slug 在 inject 前后必须一致(否则 outline 跳转 `getElementById` 找不到),所以 `slugifyHeading` 在 lowercasing 之前先剥掉 `[[label\|literal]]` / `[[label]]` 语法 — MarkdownView 的 `heading_open` 和 `extractHeadingsWithSlugs` 都经过同一个 `slugifyHeading`,自动对齐 |

实现上,先做一遍"扫描受保护区域 → 标记 segment 列表",然后只在 plaintext
segment 内做正则查找替换。可以借鉴现有 `extractSafeDetails` /
`extractSafeRawTables` 的 placeholder-extract-restore 模式,但这里的输出仍是
markdown 字符串(不是已渲染 HTML),所以更简单 — 用一个 segment array
保留 `{ kind: "plain" | "protected", text: string }` 顺序结构即可。

## 测试策略

TDD,默认顺序: failing test → smallest green → refactor。

### 单元 (`src/utils/source-inline-refs.test.ts`,新文件)

1. **基础**: 单个 K 页 title 首次出现位置被替换为 `[[title|原文本]]`
2. **第二次出现不替换**: 同一 title 多次出现,仅首次命中
3. **大小写不敏感**: title="Architecture" 命中 "architecture" / "ARCHITECTURE",保留原大小写
4. **英文 word boundary**: title="REST" 不命中 "RESTful" / "restful_api"
5. **CJK 无 boundary**: title="架构" 命中"系统架构概览"
6. **最小长度过滤**: title="a" / title="X" (英文 <3) 跳过;title="是" (CJK <2) 跳过
7. **longest-match-first**: title=["Arch", "Architecture"] 共存时,"Architecture" 字符串先被
   完整匹配,不会被 "Arch" 抢先吃掉前缀
8. **匹配后排除**: 已被替换的区段不会被其他 ref 再次扫描
9. **frontmatter 跳过**: title 在 `---...---` 块中不触发
10. **fenced code 跳过**: title 在 ` ```...``` ` 中不触发(含 mermaid)
11. **inline code 跳过**: title 在 `` `...` `` 中不触发
12. **math 跳过**: title 在 `$...$` / `$$...$$` 中不触发
13. **raw HTML 跳过**: title 在 `<details>...` / `<table>...` 块中不触发
14. **existing wikilink 跳过**: title 在 `[[...]]` / `![[...]]` 中不触发
15. **markdown link 部分跳过**: title 在 `[text](url)` 的 `(url)` 部分不触发;
    `[text]` 部分也不触发(决策为受保护)
16. **heading 内可命中**: title 出现在 `# heading` 中能被替换,且不影响 heading id slug
17. **matchedPaths 准确性**: 命中的 path 进集合;未命中的不进
18. **不可变性**: 输入数组/对象不被修改

### 集成 (`src/pages/pages.test.tsx`,扩 wiki 测试)

19. Source 页加载后,backlinks + derived 各返回 2 个 K 页,其中 2 个 title 在 body 中命中
    → MarkdownView 渲染出 2 个 inline-wikilink button,底部 panel 仅显示另 2 个
20. 点击 inline 合成的 button → `previewDoc` 被调用,右侧 preview 出现
21. 切到 source tab → `<pre>` 显示原始 body,无 inline button

### E2E (`tests/e2e/wiki.spec.ts`,扩)

22. 打开一个 source 页,验证正文中存在 inline-wikilink button(指向已知 K 页),
    点击后右侧 wiki preview 弹出对应 K 页

## 影响范围 / Consequences

- 新增 `src/utils/source-inline-refs.ts` + 单测
- 改 `src/pages/WikiPage.tsx` 的 `sourceReferences` 旁加 enhancement memo,
  改 MarkdownView body prop 与 WikiBacklinksSection references prop 的来源
- 不改 `MarkdownView`、不改 `installWikiLinks`、不改 CSS
- i18n: 不新增 key(复用现有 `linkedRefsTitle`)
- 旧 `WikiBacklinksSection` 语义偏移(原为 "all references",现为 "unlinked
  references"),通过 inline 与 panel 的视觉分工自然区分
- 性能: K 页规模通常 < 50;body 通常 < 50KB;每个 ref 一次正则扫描 O(N),
  整体 O(K·N),完全可接受。useMemo 缓存于 `(body, refs)`
- 测试覆盖率: vitest 覆盖率门槛维持 (statements 60 / branches 45 / functions 55 /
  lines 60),不下调

## 后续可演进

- 加 anchor 精度: 当 `IncomingLink.anchor` 非空时,优先匹配 heading 下方而非
  全文首次出现位置
- 加 alias 匹配: 若 K 页 frontmatter 含 `aliases:`,用别名做候选匹配关键词
  (需要 core 在 derived_pages 中返回 aliases 字段,或者额外拉 K 页 body)
- 加视觉区分: linked / sourced 在 inline button 上加 dot/边框区分(目前
  全部统一渲染为 `inline-wikilink`,看不出来源)
