# Source 正文动态嵌入 provenance wikilink — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source 层 read tab 渲染时,把已有反向边(`backlinks ∪ derived`)的 K 页 title 在 source body 中首次字面出现的位置自动合成 `[[title|原文本]]` wikilink,未匹配上的 K 页留在底部 Linked references panel。

**Architecture:** 单一纯函数 `injectInlineRefs(body, refs)` 做 markdown 源字符串预处理 — 把 body 按"可替换/受保护"切成 segment 列表,只在可替换段做 longest-match-first 扫描替换,产物丢回现有 markdown-it pipeline,wikilink rule + 现有 click delegation 一路打通到右侧 preview。WikiPage 只新增一个 useMemo 串起来,不改 MarkdownView、不加 CSS。

**Tech Stack:** TypeScript / React 19 / Vitest 4 (jsdom) / Playwright (Chromium) / markdown-it 14。Windows shell 用 `npm.cmd`。

依赖文档: [docs/adr/0002-source-inline-references.md](../../adr/0002-source-inline-references.md)。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/utils/source-inline-refs.ts` | **新建** | `injectInlineRefs(body, refs) → { body, matchedPaths }` 纯函数;segment 切片、匹配、替换 |
| `src/utils/source-inline-refs.test.ts` | **新建** | 单元测试: 基础匹配 / 大小写 / 边界 / 长度 / 排序 / 跳过区域 / 不可变性 |
| `src/pages/WikiPage.tsx` | 修改 | 加 `enhancedSourcePage` useMemo;改 MarkdownView body prop;改 WikiBacklinksSection references prop;源 tab 不变 |
| `src/pages/pages.test.tsx` | 修改 | 改写既有"merges body backlinks and frontmatter provenance"测试;加 inline 命中 + click 测试 + source tab 原文测试 |
| `src/test/fixtures.ts` | 修改 | 给 `sources/architecture.md` 一个能区分 matched / unmatched 的 body |
| `tests/e2e/wiki.spec.ts` | 修改 | 改写既有 source page 测试以反映 inline 行为 |
| `tests/e2e/fixtures.ts` | 修改 | 同 `src/test/fixtures.ts`,给 e2e 一个区分 matched/unmatched 的 source body |
| `package.json` | 修改 | version: `0.0.3` → `0.0.4` |
| `CHANGELOG.md` | 修改 | 0.0.4 条目 |
| `docs/core-contract.md` | 修改 | 在"Linked references and provenance"末尾追加一段:dikw-web 在 source read tab 做 inline 合成 |
| `CLAUDE.md` | 修改 | §Markdown reader 段落补一句 source 页 inline 合成行为 |

---

## Task 1: 工具骨架 + 基础替换 + 首次出现规则

**Files:**
- Create: `src/utils/source-inline-refs.ts`
- Test: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 写失败测试**

写到 `src/utils/source-inline-refs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { injectInlineRefs, type InlineRefMatch } from "./source-inline-refs";

const ref = (path: string, title: string): InlineRefMatch => ({ path, title });

describe("injectInlineRefs", () => {
  it("returns the body unchanged and an empty matched set when no refs are given", () => {
    const result = injectInlineRefs("# Hello\n\nBody text.", []);
    expect(result.body).toBe("# Hello\n\nBody text.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("replaces the first literal occurrence of a title with a wikilink marker", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("See the Architecture page.", refs);
    expect(result.body).toBe("See the [[Architecture|Architecture]] page.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("only replaces the first occurrence per ref, leaving later occurrences intact", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("Architecture is the topic. Architecture matters.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is the topic. Architecture matters.");
  });

  it("scans multiple refs independently in a single pass", () => {
    const refs = [ref("wiki/architecture.md", "Architecture"), ref("wiki/synthesis.md", "Synthesis")];
    const result = injectInlineRefs("Architecture then Synthesis.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] then [[Synthesis|Synthesis]].");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md", "wiki/synthesis.md"]));
  });

  it("leaves matchedPaths empty for refs that never appear in the body", () => {
    const refs = [ref("wiki/missing.md", "MissingTitle")];
    const result = injectInlineRefs("Body without any match.", refs);
    expect(result.body).toBe("Body without any match.");
    expect(result.matchedPaths).toEqual(new Set());
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — module `./source-inline-refs` 不存在。

- [ ] **Step 3: 最小实现**

写到 `src/utils/source-inline-refs.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (5 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): substring-based first-occurrence injection"
```

---

## Task 2: 大小写不敏感 + 保留原文字面 + 英文 word boundary

**Files:**
- Modify: `src/utils/source-inline-refs.ts`
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 3 个失败测试**

追加到 `src/utils/source-inline-refs.test.ts` describe 块内:

```ts
  it("matches case-insensitively and preserves the source-side literal in the button label", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("the architecture of...", refs);
    expect(result.body).toBe("the [[Architecture|architecture]] of...");
  });

  it("preserves uppercase source literal when the title is mixed-case", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("THE ARCHITECTURE OF...", refs);
    expect(result.body).toBe("THE [[Architecture|ARCHITECTURE]] OF...");
  });

  it("requires word boundaries for ASCII titles (does not match inside larger ASCII words)", () => {
    const refs = [ref("wiki/rest.md", "REST")];
    const result = injectInlineRefs("a RESTful API and restful_api too", refs);
    expect(result.body).toBe("a RESTful API and restful_api too");
    expect(result.matchedPaths).toEqual(new Set());
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — 3 个新测试,前 2 个因为大小写敏感不匹配/匹配但字面错,第 3 个因为 substring 命中。

- [ ] **Step 3: 用正则替换 + word boundary 实现**

替换 `injectInlineRefs` 函数体(保留导出类型不变):

```ts
const ASCII_BOUNDARY_HEAD = /[\w]/u;
const ASCII_BOUNDARY_TAIL = /[\w]/u;

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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (8 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): case-insensitive match + word boundary + literal preservation"
```

---

## Task 3: CJK 无边界 + 最小长度过滤 + longest-match-first + 已替换段不复扫

**Files:**
- Modify: `src/utils/source-inline-refs.ts`
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 5 个失败测试**

追加到 describe 块内:

```ts
  it("matches CJK titles without word boundaries (CJK has no inter-word space)", () => {
    const refs = [ref("wiki/arch.md", "架构")];
    const result = injectInlineRefs("系统架构包含三个核心组件。", refs);
    expect(result.body).toBe("系统[[架构|架构]]包含三个核心组件。");
  });

  it("skips ASCII titles shorter than 3 characters", () => {
    const refs = [ref("wiki/a.md", "AI"), ref("wiki/b.md", "x")];
    const result = injectInlineRefs("AI and x are both short.", refs);
    expect(result.body).toBe("AI and x are both short.");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("skips CJK titles shorter than 2 characters", () => {
    const refs = [ref("wiki/y.md", "是")];
    const result = injectInlineRefs("这是一段话。", refs);
    expect(result.body).toBe("这是一段话。");
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("matches the longest title first when titles overlap by prefix", () => {
    // Refs in 'wrong' order on purpose — the longer title must win.
    const refs = [ref("wiki/arch.md", "Arch"), ref("wiki/architecture.md", "Architecture")];
    const result = injectInlineRefs("Architecture is everything.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] is everything.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("does not re-scan a region that has already been wrapped by a prior ref", () => {
    // After 'Architecture' is wrapped, the inner 'Arch' substring must not be
    // independently re-matched by a later ref.
    const refs = [ref("wiki/architecture.md", "Architecture"), ref("wiki/arch.md", "Arch")];
    const result = injectInlineRefs("Architecture mentioned once.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]] mentioned once.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — 5 个新测试,CJK + 长度过滤 + longest-match-first + 防止 已替换区段被复扫。

- [ ] **Step 3: 实现 — 引入 segment 模型 + 排序 + 长度阈值**

完整替换 `src/utils/source-inline-refs.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (13 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): segment model + longest-match-first + min length"
```

---

## Task 4: 跳过 frontmatter / fenced code / indented code

**Files:**
- Modify: `src/utils/source-inline-refs.ts`
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 5 个失败测试**

追加到 describe 块内:

```ts
  it("never replaces inside YAML frontmatter", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const body = "---\ntitle: Architecture notes\n---\n\nBody mentions Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "---\ntitle: Architecture notes\n---\n\nBody mentions [[Architecture|Architecture]]."
    );
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md"]));
  });

  it("never replaces inside fenced code blocks", () => {
    const refs = [ref("wiki/architecture.md", "Architecture")];
    const body = "Plain Architecture.\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Plain [[Architecture|Architecture]].\n\n```ts\nconst Architecture = 1;\n```\n\nLater Architecture again."
    );
  });

  it("never replaces inside mermaid fences (mermaid is a fenced code lang)", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "```mermaid\ngraph LR\n  A[Architecture] --> B\n```";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(body);
    expect(result.matchedPaths).toEqual(new Set());
  });

  it("supports tilde-fenced code blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "~~~\nArchitecture inside tildes\n~~~\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "~~~\nArchitecture inside tildes\n~~~\n\nAfter [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside indented (4-space) code blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Before Architecture.\n\n    Architecture in indented code\n    more code\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before [[Architecture|Architecture]].\n\n    Architecture in indented code\n    more code\n\nAfter Architecture."
    );
    // Only the first plain occurrence (Before) is replaced.
    expect(result.matchedPaths).toEqual(new Set(["wiki/arch.md"]));
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — 5 个新测试。

- [ ] **Step 3: 加 segment-extraction 阶段,识别这三类受保护块**

在 `src/utils/source-inline-refs.ts` 顶部(types 之下)加 segmentation 函数,并改 `injectInlineRefs` 使用它:

```ts
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;
const FENCED_CODE_PATTERN = /(^|\n)(?<fence>```|~~~)[^\n]*\n[\s\S]*?\n\k<fence>(?=\n|$)/g;
// Indented code: a sequence of one-or-more lines starting with 4 spaces (or a
// tab), where the run is preceded by a blank line (or BOS). Simplified to "at
// least 4 leading spaces on a fresh paragraph line".
const INDENTED_CODE_PATTERN = /(^|\n\n)((?:    [^\n]*(?:\n|$))+)/g;

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
```

把 `injectInlineRefs` 中的初始化改为:

```ts
  const segments: Segment[] = sliceByRanges(body, collectProtectedRanges(body));
```

(其余循环保持不变。)

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (18 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): protect frontmatter + fenced + indented code"
```

---

## Task 5: 跳过 inline code + math (inline / display)

**Files:**
- Modify: `src/utils/source-inline-refs.ts`
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 4 个失败测试**

追加到 describe 块内:

```ts
  it("never replaces inside inline code", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Use `Architecture.tsx` for the file. Architecture is the concept.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Use `Architecture.tsx` for the file. [[Architecture|Architecture]] is the concept.");
  });

  it("never replaces inside display math ($$...$$)", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "$$\\text{Architecture} = f(x)$$\n\nThen Architecture is great.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "$$\\text{Architecture} = f(x)$$\n\nThen [[Architecture|Architecture]] is great."
    );
  });

  it("never replaces inside inline math ($...$) within the same line", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Inline $Architecture_i$ and then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Inline $Architecture_i$ and then [[Architecture|Architecture]].");
  });

  it("escaped dollar (\\$) does not open a math span", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Cost is \\$5 for Architecture lessons.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("Cost is \\$5 for [[Architecture|Architecture]] lessons.");
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — 4 个新测试。

- [ ] **Step 3: 扩展 `collectProtectedRanges` 加 inline code + math 模式**

在 `src/utils/source-inline-refs.ts` 顶部加正则:

```ts
const INLINE_CODE_PATTERN = /(`+)(?:.+?)\1/g;
const DISPLAY_MATH_PATTERN = /\$\$[\s\S]*?\$\$/g;
// Inline math: opening $ must not be preceded by '\' and not followed by '$';
// closing $ must not be preceded by '\'. Content single-line.
const INLINE_MATH_PATTERN = /(?<!\\)\$(?!\$)((?:\\\$|[^\n$])+?)(?<!\\)\$/g;
```

在 `collectProtectedRanges` 中,在 frontmatter 检测之后、fenced code 之前(实际顺序无所谓,因为最后会 merge)追加:

```ts
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
```

注意:fenced code 必须先于 inline code 扫描(否则 fence 内的反引号会被误识别),但 `collectProtectedRanges` 已通过 `mergeRanges` 合并,所以只要 fenced code 的 range 被先 push 就 OK。已经是这样了 — fenced code 在 frontmatter 之后被 push,inline code 在它之后被 push,但 merge 会按 start 排序后合并,fenced code 的整段 range 会覆盖其内的 inline code range。**校验**: 在 Step 4 运行的全部测试中,fenced code 内的反引号没有被泄漏出来(已有"never replaces inside fenced code blocks"测试覆盖)。

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (22 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): protect inline code + display/inline math"
```

---

## Task 6: 跳过 raw HTML 块 + existing wikilink/image + markdown link 整体

**Files:**
- Modify: `src/utils/source-inline-refs.ts`
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 5 个失败测试**

追加到 describe 块内:

```ts
  it("never replaces inside raw <details> blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Before.\n\n<details>\n<summary>Architecture details</summary>\nInner Architecture.\n</details>\n\nAfter [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside raw <table> blocks", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "<table><tr><td>Architecture cell</td></tr></table>\n\nThen Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "<table><tr><td>Architecture cell</td></tr></table>\n\nThen [[Architecture|Architecture]]."
    );
  });

  it("never replaces inside existing wikilinks or obsidian image embeds", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "See [[Architecture]] and ![[notes/Architecture.png]] then Architecture is back.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "See [[Architecture]] and ![[notes/Architecture.png]] then [[Architecture|Architecture]] is back."
    );
  });

  it("never replaces inside a markdown link [text](url) — neither text nor url", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "Read [the Architecture guide](https://example.com/Architecture). Then Architecture.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe(
      "Read [the Architecture guide](https://example.com/Architecture). Then [[Architecture|Architecture]]."
    );
  });

  it("allows replacement inside heading text", () => {
    const refs = [ref("wiki/arch.md", "Architecture")];
    const body = "# Architecture source\n\nBody.";
    const result = injectInlineRefs(body, refs);
    expect(result.body).toBe("# [[Architecture|Architecture]] source\n\nBody.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/arch.md"]));
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: FAIL — 5 个新测试。

- [ ] **Step 3: 扩展 `collectProtectedRanges`**

在 `src/utils/source-inline-refs.ts` 顶部加正则:

```ts
// Raw HTML block: a `<tag ...>...</tag>` span where tag is a known block tag.
// Conservative whitelist matching the markdown reader's sanitizer scope.
const RAW_HTML_BLOCK_PATTERN = /<(details|table|summary|div|section|article|aside|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Existing wikilink (with optional image bang) — must NOT be wrapped again.
const EXISTING_WIKILINK_PATTERN = /!?\[\[[^\]\n]+?\]\]/g;
// Markdown link: [text](url). Bracket part may contain ] only if escaped — accept simple form.
const MARKDOWN_LINK_PATTERN = /\[(?:\\\]|[^\]\n])+?\]\((?:\\\)|[^)\n])+?\)/g;
```

在 `collectProtectedRanges` 中追加(顺序在已有 push 之后):

```ts
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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (27 tests)。

- [ ] **Step 5: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "feat(source-inline-refs): protect raw HTML + wikilink + markdown link"
```

---

## Task 7: 不可变性 + matchedPaths 精度回归保护

**Files:**
- Modify: `src/utils/source-inline-refs.test.ts`

- [ ] **Step 1: 加 3 个断言测试**

追加到 describe 块内:

```ts
  it("does not mutate the input refs array or its entries", () => {
    const original: InlineRefMatch[] = [
      ref("wiki/architecture.md", "Architecture"),
      ref("wiki/synthesis.md", "Synthesis")
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    injectInlineRefs("Architecture then Synthesis.", original);
    expect(original).toEqual(snapshot);
  });

  it("returns matchedPaths exactly equal to the set of refs that were injected", () => {
    const refs = [
      ref("wiki/architecture.md", "Architecture"),  // present
      ref("wiki/synthesis.md", "Synthesis"),         // present
      ref("wiki/missing.md", "AbsolutelyMissing")    // absent
    ];
    const result = injectInlineRefs("Architecture then Synthesis only.", refs);
    expect(result.matchedPaths).toEqual(new Set(["wiki/architecture.md", "wiki/synthesis.md"]));
  });

  it("counts each matched ref's path exactly once even when scanned in unusual order", () => {
    // Same ref appearing multiple times in input — only one injection happens,
    // matchedPaths has one entry.
    const refs = [
      ref("wiki/arch.md", "Architecture"),
      ref("wiki/arch.md", "Architecture")
    ];
    const result = injectInlineRefs("Architecture, Architecture, Architecture.", refs);
    expect(result.body).toBe("[[Architecture|Architecture]], Architecture, Architecture.");
    expect(result.matchedPaths).toEqual(new Set(["wiki/arch.md"]));
  });
```

- [ ] **Step 2: 跑测试看绿(应该已经通过,这是回归保护)**

Run: `npx vitest run src/utils/source-inline-refs.test.ts`
Expected: PASS (30 tests)。 如果"matched-once-per-path"测试因为第二个相同 ref 找到了文本里后续的 "Architecture" 而 fail,在 `injectInlineRefs` 主循环里加一个 `if (matchedPaths.has(ref.path)) continue;`:

```ts
  for (const ref of sortRefsLongestFirst(refs)) {
    if (!meetsMinLength(ref.title)) {
      continue;
    }
    if (matchedPaths.has(ref.path)) {
      continue;
    }
    if (injectOneRef(segments, ref)) {
      matchedPaths.add(ref.path);
    }
  }
```

(然后再跑测试验证 PASS。)

- [ ] **Step 3: 跑全套单测确认无回归**

Run: `npm.cmd run test`
Expected: PASS,全套单测含 source-inline-refs 30 个。

- [ ] **Step 4: commit**

```powershell
git add src/utils/source-inline-refs.ts src/utils/source-inline-refs.test.ts
git commit -m "test(source-inline-refs): immutability + dedupe-by-path guards"
```

---

## Task 8: WikiPage 集成 + fixtures 调整 + 集成测试更新

**Files:**
- Modify: `src/pages/WikiPage.tsx`
- Modify: `src/pages/pages.test.tsx`
- Modify: `src/test/fixtures.ts`

### 8a. 改 fixture 让 source body 能产出可区分的 matched / unmatched

- [ ] **Step 1: 改写 `sources/architecture.md` 的 body**

在 `src/test/fixtures.ts:208-217` 把 source body 改为同时含 "Architecture" (matched) 和不含 "Synthesis"(unmatched):

```ts
  "sources/architecture.md": {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    layer: "source",
    title: "Architecture source",
    // Body contains 'Architecture' (matches the K page title) but does NOT
    // contain 'Synthesis' — so Architecture should become an inline wikilink
    // and Synthesis should fall to the bottom Unlinked-references panel.
    body: "# Architecture source\n\nThe Architecture is the main topic of this source.",
    anchors: [{ chunk_id: 201, seq: 1, start: 0, end: 38 }],
    assets: []
  }
```

### 8b. 集成 WikiPage

- [ ] **Step 2: 在 WikiPage 加 `enhancedSourcePage` useMemo 并接入 props**

在 `src/pages/WikiPage.tsx` 顶部 imports 块追加:

```ts
import { injectInlineRefs } from "../utils/source-inline-refs";
```

在现有 `sourceReferences` useMemo 之后(约 L351-360 之间)追加:

```ts
  // Source 层 read tab 在 body 中首次出现的 K 页 title 上注入合成 wikilink。
  // 非 source 层不动 body;empty refs 时直接退化为原 body + 空 matched set。
  const enhancedSourceBody = useMemo(() => {
    if (!page || page.layer !== "source") {
      return { body: page?.body ?? "", matchedPaths: new Set<string>() };
    }
    return injectInlineRefs(page.body, sourceReferences);
  }, [page, sourceReferences]);

  const unlinkedReferences = useMemo<SourceReference[]>(
    () => sourceReferences.filter((ref) => !enhancedSourceBody.matchedPaths.has(ref.path)),
    [sourceReferences, enhancedSourceBody.matchedPaths]
  );
```

接下来改 WikiReader 调用处(约 L407-418),把传给 WikiReader 的 body 和 references 改成新值。但 WikiReader 当前直接吃 `page` 对象不吃单独的 body,所以要给 WikiReader 一个 `bodyOverride?: string` prop 用于 source 层。

修改 WikiReader 调用:

```tsx
        <WikiReader
          page={page}
          doc={selectedDoc}
          loading={pageLoading}
          error={pageError}
          onWikiLink={openWikiLink}
          references={unlinkedReferences}
          onOpenBacklink={openBacklink}
          copy={copy}
          assetBaseUrl={assetBaseUrl}
          assetToken={assetToken}
          enhancedBody={page?.layer === "source" ? enhancedSourceBody.body : undefined}
        />
```

然后改 `WikiReader` 函数签名(约 L532-554)加 `enhancedBody?: string`,并在 read tab 的 `<MarkdownView body={...}>` 里优先用它:

```tsx
function WikiReader({
  page,
  doc,
  loading,
  error,
  onWikiLink,
  references,
  onOpenBacklink,
  copy,
  assetBaseUrl,
  assetToken,
  enhancedBody
}: {
  page: PageReadResult | null;
  doc: DocumentRecord | null;
  loading: boolean;
  error: unknown;
  onWikiLink: (target: string) => void;
  references: SourceReference[];
  onOpenBacklink: (path: string) => void;
  copy: WikiCopy;
  assetBaseUrl: string;
  assetToken: string;
  enhancedBody?: string;
}) {
```

然后在 `<MarkdownView>` 调用(约 L620-628)把 body 改为:

```tsx
              <MarkdownView
                body={enhancedBody ?? page.body}
                fallbackTitle={page.title || getMarkdownTitle(page.body) || basename(page.path)}
                onWikiLink={onWikiLink}
                showFrontmatter={false}
                assets={page.assets}
                assetBaseUrl={assetBaseUrl}
                assetToken={assetToken}
              />
```

Source tab(约 L647-651)保持不变 — 它已经在用 `page.body`(原始)。Outline / Info tab 也保持原状,因为它们用的 `parsed` 是从 `page.body` 算出来的,跟 enhancedBody 无关。

### 8c. 集成测试

- [ ] **Step 3: 写失败的集成测试**

改写 `src/pages/pages.test.tsx` 中既有的 "merges body backlinks and frontmatter provenance into the source linked references panel" 测试(L179-235)— 整段替换为:

```tsx
  it("inlines matched K-pages into the source body and lists unmatched ones in the panel", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: [
            { src_doc_id: "wiki-architecture", src_path: "wiki/architecture.md", link_type: "wikilink", anchor: null, line: 3 }
          ]
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "wiki-architecture", path: "wiki/architecture.md", title: "Architecture" },
            { doc_id: "wiki-synthesis", path: "wiki/synthesis.md", title: "Synthesis" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["wiki/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Body 内联:fixture body 含 "Architecture" — 应该被注入为 inline wikilink button。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    expect(inlineButton).toHaveClass("inline-wikilink");

    // Panel: 只剩 Synthesis(body 中无字面 "Synthesis")。
    const refs = within(reader).getByRole("region", { name: "Linked references" });
    expect(within(refs).getByRole("button", { name: "Synthesis" })).toBeInTheDocument();
    expect(within(refs).queryByRole("button", { name: "Architecture" })).not.toBeInTheDocument();

    // Synthesis 在 panel 里只有 sourced chip(matched 的 Architecture 不出现)。
    expect(within(refs).getByText("sourced")).toBeInTheDocument();
    expect(within(refs).queryByText("linked")).not.toBeInTheDocument();
  });

  it("opens the K-page preview when an inline injected wikilink is clicked", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "wiki-architecture", path: "wiki/architecture.md", title: "Architecture" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["wiki/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    await userEvent.click(inlineButton);

    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("wiki/architecture.md")).toBeInTheDocument();
  });

  it("renders the original source body verbatim in the Source tab (no inline injection)", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "wiki-architecture", path: "wiki/architecture.md", title: "Architecture" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["wiki/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    await screen.findByRole("region", { name: "Linked references" });
    await userEvent.click(screen.getByRole("tab", { name: /Source/ }));

    const sourceTab = await screen.findByRole("tabpanel", { name: /Source/ });
    // The raw source code <pre> renders the original body — no [[...|...]] markers.
    expect(within(sourceTab).getByText(/The Architecture is the main topic/)).toBeInTheDocument();
    expect(within(sourceTab).queryByText(/\[\[Architecture\|Architecture\]\]/)).not.toBeInTheDocument();
  });
```

注意:旧测试 "surfaces source-page backlinks and opens them in the preview panel" (L126-177) 也会因为 fixture body 改动 + 新行为受影响 — 它的 backlink 也是 "Architecture",会被 inline 抢走 panel 里的按钮。改写它:

把 L126-177 的旧测试中第 169-176 行(panel 断言部分)替换为:

```tsx
    // Body backlink 'Architecture' 在源 body 里有字面命中 → 走 inline,不在 panel 里。
    // 用 read tabpanel 内的 inline-wikilink 按钮验证。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    await waitFor(() => expect(linksCalls).toHaveLength(1));
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    expect(inlineButton).toHaveClass("inline-wikilink");

    await userEvent.click(inlineButton);
    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("wiki/architecture.md")).toBeInTheDocument();
```

(整个测试名也改为更准确的描述:`"inlines source-page backlinks into the body and opens preview on click"`。)

- [ ] **Step 4: 跑全套单测看 WikiPage 通过**

Run: `npm.cmd run test`
Expected: PASS,所有测试包括 3 个新的 source inline 集成测试 + 改写的 backlinks 测试。如有失败,根据 jsdom 的 `inline-wikilink` 按钮可见性、tab 切换的 act() 警告等修正断言写法(不动产品代码)。

- [ ] **Step 5: typecheck + commit**

```powershell
npm.cmd run typecheck
git add src/pages/WikiPage.tsx src/pages/pages.test.tsx src/test/fixtures.ts
git commit -m "feat(wiki): inline source backlinks via injectInlineRefs; unmatched stay in panel"
```

---

## Task 9: E2E + 版本 + CHANGELOG + 文档 + final verify

**Files:**
- Modify: `tests/e2e/fixtures.ts`
- Modify: `tests/e2e/wiki.spec.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/core-contract.md`
- Modify: `CLAUDE.md`

### 9a. E2E fixture + spec 改造

- [ ] **Step 1: 改写 e2e fixture body**

在 `tests/e2e/fixtures.ts:235-243` 把 `sources/architecture.md` body 改为含 Architecture 不含 Synthesis 字面:

```ts
  "sources/architecture.md": {
    doc_id: "source-architecture",
    path: "sources/architecture.md",
    layer: "source",
    title: "Architecture source",
    body: "# Architecture source\n\nThe Architecture is the main topic of this source.",
    anchors: [],
    assets: []
  },
```

- [ ] **Step 2: 改写 `tests/e2e/wiki.spec.ts` "source page" 测试(L112-137)**

整段替换为:

```ts
test("source page inlines K-page title in body and keeps unmatched refs in the panel", async ({ page }) => {
  await page.goto("/#wiki");

  const tree = page.getByRole("tree", { name: "Base directory" });
  await tree.getByRole("button", { name: "sources", exact: true }).click();
  await tree.getByRole("button", { name: /Architecture source/ }).click();

  const reader = page.getByRole("main", { name: "Wiki reader" });
  const readTab = reader.getByRole("tabpanel", { name: "Read" });

  // Body 内联:fixture body 含 "Architecture" → 应该被替换成可点的 inline wikilink button。
  const inlineArchitecture = readTab.getByRole("button", { name: "Architecture", exact: true });
  await expect(inlineArchitecture).toBeVisible();
  await expect(inlineArchitecture).toHaveClass(/inline-wikilink/);

  // Panel 只剩 Synthesis(body 中无字面 "Synthesis")。
  const refs = page.getByRole("region", { name: "Linked references" });
  await expect(refs.getByRole("button", { name: "Synthesis", exact: true })).toBeVisible();
  await expect(refs.getByRole("button", { name: "Architecture", exact: true })).toHaveCount(0);

  // Synthesis 只有 sourced(matched 的 Architecture 没在 panel 里,所以也没 linked chip)。
  const synthesisItem = refs.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Synthesis", exact: true }) });
  await expect(synthesisItem.getByText("sourced", { exact: true })).toBeVisible();
  await expect(refs.getByText("linked", { exact: true })).toHaveCount(0);

  // 点击 inline button 弹 preview。
  await inlineArchitecture.click();
  const preview = page.getByRole("region", { name: "Wiki link preview" });
  await expect(preview.getByRole("heading", { name: "Architecture" })).toBeVisible();

  // Source tab 显示原始 body,不含 [[...|...]] 字符。
  await preview.getByRole("button", { name: "Collapse link preview" }).click();
  await reader.getByRole("tab", { name: "Source" }).click();
  await expect(reader.getByText(/The Architecture is the main topic/)).toBeVisible();
  await expect(reader.locator("pre.wiki-source-code")).not.toContainText("[[Architecture|");
});
```

- [ ] **Step 3: 跑 e2e 看红再看绿**

Run: `npx playwright test tests/e2e/wiki.spec.ts -g "source page inlines"`
Expected: PASS。若失败,先 `npx playwright test tests/e2e/wiki.spec.ts -g "source page inlines" --headed` 观察实际渲染,修断言不要碰产品代码(产品行为已经被单测 + 集成测试钉住)。

### 9b. 版本 / CHANGELOG / 文档

- [ ] **Step 4: bump version 与 CHANGELOG**

`package.json`:`"version": "0.0.3"` → `"version": "0.0.4"`,也跑一次 `npm.cmd install` 让 lockfile 同步:

```powershell
npm.cmd install --package-lock-only
```

`CHANGELOG.md` 顶部加新条目:

```md
## 0.0.4 — 2026-05-24

### Source reader

- Source 层 read tab 渲染时,把已有反向边的 K 页 title(`backlinks ∪ derived`)
  在 source body 中**首次字面出现**位置自动合成 `[[title|原文本]]` wikilink,
  阅读体验向 wiki 页对齐。未匹配上的 K 页留在底部 Linked references panel。
  Source tab(raw view)始终用原始 body,不做替换。
- 匹配规则:大小写不敏感、英文要求 `\b` 边界、CJK 无边界、最小长度英文 ≥3
  CJK ≥2、longest-match-first、保留 source 原文字面写法。
- 受保护区段不替换:YAML frontmatter / fenced & indented code(含 mermaid)/
  inline code / inline & display math / raw HTML 块(details/table/...)/
  existing wikilink(含 image embed)/ markdown link 整体。
- 实现:新增 `src/utils/source-inline-refs.ts` 纯函数(30+ 单元测试),
  WikiPage 加 `enhancedSourceBody` useMemo 串起来,MarkdownView 和
  wikilink rule 不动 — click 走现有 `previewDoc` 通道直达右侧 preview。
  零新增 CSS / 零新增 i18n key。
```

- [ ] **Step 5: 文档同步**

`docs/core-contract.md` 在末尾"Linked references and provenance"段加一段:

```md
### Web 渲染:source read tab 的 inline 合成

dikw-web 在 source 层 read tab 渲染时,会把 backlinks ∪ derived 合集中
**title 在 source body 首次字面出现**的位置自动合成 wikilink(参见
`docs/adr/0002-source-inline-references.md`)。匹配宽松:大小写不敏感、
英文要求 `\b`、CJK 不要求、最小长度英文 ≥3 / CJK ≥2、长 title 优先。
受保护区段(frontmatter / code / math / raw HTML / 已有 wikilink /
markdown link)不替换。未匹配 K 页留在底部 panel。Source tab 始终
显示原始 body,不做替换。本机制不改动 core 契约。
```

`CLAUDE.md` 在 §Markdown reader 段落末尾追加一句:

```md
Source 层 read tab 在渲染前会跑 `injectInlineRefs`(`src/utils/source-inline-refs.ts`),
把已有反向边的 K 页 title 在 body 首次出现位置合成 `[[title|literal]]` wikilink。
未匹配上的 K 页留在底部 Linked references panel。Source tab 永远显示原始 `page.body`。
设计细节见 `docs/adr/0002-source-inline-references.md`。
```

- [ ] **Step 6: final verify**

Run: `npm.cmd run verify`
Expected: typecheck OK / coverage 满足现有门槛 / build OK / e2e PASS。

如 e2e 偶发 flaky(graph.spec 已知,详见 memory [[project_flaky_graph_e2e]]),只为该 spec 做**一次** rerun:

```powershell
npx playwright test tests/e2e/graph.spec.ts
```

- [ ] **Step 7: commit**

```powershell
git add tests/e2e/fixtures.ts tests/e2e/wiki.spec.ts package.json package-lock.json CHANGELOG.md docs/core-contract.md CLAUDE.md
git commit -m "feat(wiki): source inline refs e2e + 0.0.4 + docs sync"
```

- [ ] **Step 8: 走 §Delivery workflow 4-8(独立于本 plan)**

按 `CLAUDE.md` §Delivery workflow:
- `/codex:review --background`(≤3 轮)
- `/code-review` 最终一遍
- Chrome MCP 真页面跑一遍 source 层渲染验证
- 推送 + `gh pr create` + 主动 watch CI 和 PR comments
- squash merge

不在本实施 plan 范围内。

---

## Self-Review

### Spec coverage 检查

| Spec 条目 | 对应 Task |
|---|---|
| 候选范围 = `mergeSourceReferences` 全集 | Task 8 (沿用现有 `sourceReferences`) |
| 首次出现 / 保留字面 / 大小写不敏感 / `\b` / CJK / 长度阈值 / longest-match | Task 1-3 |
| 受保护区段 7 类 | Task 4-6 |
| heading 允许命中 | Task 6 |
| matched / unmatched 分流 | Task 8 |
| Source tab 用原文 | Task 8 集成测试 + Task 9 e2e |
| 复用 wikilink rule / click delegation / previewDoc | Task 8 集成测试断言 click → preview |
| 不改 MarkdownView / 不加 CSS / 不加 i18n key | Task 8 实现,未触及 MarkdownView / styles.css / i18n.ts |
| 22 个测试点 (spec §测试策略) | Task 1-7 共 30 个单测,Task 8 集成 3 个,Task 9 e2e 1 个 |
| package version + CHANGELOG + docs 同步 | Task 9 |

### Placeholder scan

无 TBD / TODO / "implement later" / 抽象描述。每个 step 含完整代码或完整命令。✓

### Type consistency

- `InlineRefMatch { path, title }` 与 `SourceReference extends BacklinkRef { path, title, layer, sources }` — `InlineRefMatch` 只需要 `path` + `title` 字段,`SourceReference` 是其超集,Task 8 中 `injectInlineRefs(page.body, sourceReferences)` 调用即合法(TypeScript 结构化类型)。✓
- `InjectInlineRefsResult { body, matchedPaths }` 在 Task 1 定义,Task 8 中 `enhancedSourceBody.body` 和 `enhancedSourceBody.matchedPaths.has(ref.path)` 引用一致。✓
- `enhancedBody?: string` prop 在 Task 8 同时加到 WikiReader 调用 + 函数签名 + 内部 `<MarkdownView body={...}>` 使用。✓

---

## 执行选择

Plan complete and saved to `docs/superpowers/plans/2026-05-24-source-inline-references.md`. 两种执行模式:

1. **Subagent-Driven (recommended)** — 每个 Task 一个全新 subagent,Task 间我做 review,迭代快
2. **Inline Execution** — 在当前会话执行,带检查点

哪种?
