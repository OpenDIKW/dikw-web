import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { useEffect, useMemo, useRef } from "react";
import { parseMarkdownDocument, type FrontmatterMeta } from "../utils/markdown";

interface MarkdownViewProps {
  body: string;
  fallbackTitle?: string | null;
  onWikiLink?: (target: string) => void;
  showFrontmatter?: boolean;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

installWikiLinks(markdown);
installMath(markdown);
installRendererRules(markdown);

export function MarkdownView({ body, fallbackTitle, onWikiLink, showFrontmatter = true }: MarkdownViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { html, meta, needsFallbackTitle } = useMemo(() => {
    const parsed = parseMarkdownDocument(body, { stripDuplicateTitle: false });
    return {
      html: renderMarkdown(parsed.body),
      meta: parsed.meta,
      needsFallbackTitle: Boolean(fallbackTitle && !hasTopHeading(parsed.body))
    };
  }, [body, fallbackTitle]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) {
      return;
    }
    let cancelled = false;
    void renderMermaidDiagrams(root, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html]);

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    const target = element?.dataset.wikiLink;
    if (target) {
      event.preventDefault();
      onWikiLink?.(target);
      return;
    }

    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    if (href.startsWith("#") && href.length > 1) {
      event.preventDefault();
      const targetElement = findDocumentAnchor(event.currentTarget, href.slice(1));
      targetElement?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  return (
    <article className="markdown-view" onClick={handleClick}>
      {showFrontmatter ? <FrontmatterSummary meta={meta} /> : null}
      {needsFallbackTitle ? <h1 className="markdown-fallback-title">{fallbackTitle}</h1> : null}
      <div ref={bodyRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

function hasTopHeading(body: string): boolean {
  return /^#\s+.+$/m.test(body);
}

function FrontmatterSummary({ meta }: { meta: FrontmatterMeta }) {
  const tags = asList(meta.tags);
  const sources = asList(meta.sources);
  const rows = [
    ["id", meta.id],
    ["type", meta.type ?? meta.kind],
    ["updated", meta.updated],
    ["status", meta.status]
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0);

  if (!rows.length && !tags.length && !sources.length) {
    return null;
  }

  return (
    <section className="frontmatter-summary" aria-label="Document metadata">
      {rows.map(([label, value]) => (
        <span className="frontmatter-chip" key={label}>
          <strong>{label}</strong>
          {value}
        </span>
      ))}
      {tags.map((tag) => (
        <span className="frontmatter-chip frontmatter-chip--tag" key={`tag-${tag}`}>
          #{tag}
        </span>
      ))}
      {sources.map((source) => (
        <span className="frontmatter-chip frontmatter-chip--source" key={`source-${source}`}>
          {source}
        </span>
      ))}
    </section>
  );
}

function installWikiLinks(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "wikilink", (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b) {
      return false;
    }

    const end = state.src.indexOf("]]", start + 2);
    if (end < 0) {
      return false;
    }

    if (!silent) {
      const raw = state.src.slice(start + 2, end).trim();
      const [targetPart, labelPart] = raw.split("|", 2);
      const target = targetPart.trim();
      const label = (labelPart ?? targetPart).trim();
      const token = state.push("wikilink", "", 0);
      token.attrSet("data-target", target);
      token.content = label || target;
    }

    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, index) => {
    const token = tokens[index];
    const target = token.attrGet("data-target") ?? token.content;
    return `<button type="button" class="inline-wikilink" data-wiki-link="${escapeAttribute(
      target
    )}">${escapeHtml(token.content)}</button>`;
  };
}

function installMath(md: MarkdownIt) {
  md.inline.ruler.before("escape", "math_inline", (state: StateInline, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24) {
      return false;
    }
    if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c) {
      return false;
    }

    let end = start + 1;
    while ((end = state.src.indexOf("$", end)) >= 0) {
      if (state.src.charCodeAt(end - 1) === 0x5c) {
        end += 1;
        continue;
      }
      const content = state.src.slice(start + 1, end);
      if (!content || content.includes("\n")) {
        return false;
      }
      if (!silent) {
        const token = state.push("math_inline", "math", 0);
        token.content = content.trim();
      }
      state.pos = end + 1;
      return true;
    }
    return false;
  });

  md.block.ruler.before(
    "fence",
    "math_block",
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (state.src.slice(start, start + 2) !== "$$") {
        return false;
      }

      const firstLine = state.src.slice(start + 2, max);
      let content = "";
      let nextLine = startLine;
      const sameLineClose = firstLine.lastIndexOf("$$");
      if (sameLineClose >= 0 && firstLine.slice(0, sameLineClose).trim().length > 0) {
        content = firstLine.slice(0, sameLineClose);
        nextLine = startLine + 1;
      } else {
        content = `${firstLine}\n`;
        let found = false;
        while (++nextLine < endLine) {
          const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
          const lineMax = state.eMarks[nextLine];
          const line = state.src.slice(lineStart, lineMax);
          const close = line.indexOf("$$");
          if (close >= 0) {
            content += line.slice(0, close);
            found = true;
            nextLine += 1;
            break;
          }
          content += `${line}\n`;
        }
        if (!found) {
          return false;
        }
      }

      if (!silent) {
        const token = state.push("math_block", "math", 0);
        token.block = true;
        token.content = content.trim();
        token.map = [startLine, nextLine];
      }
      state.line = nextLine;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] }
  );

  md.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false);
  md.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index].content, true)}\n`;
}

function installRendererRules(md: MarkdownIt) {
  const defaultRender =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const headingRender =
    md.renderer.rules.heading_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noreferrer");
    }
    return defaultRender(tokens, index, options, env, self);
  };

  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const inline = tokens[index + 1];
    const slug = inline?.type === "inline" ? uniqueHeadingSlug(env, inline.content) : "";
    if (slug) {
      tokens[index].attrSet("id", slug);
    }
    return headingRender(tokens, index, options, env, self);
  };

  md.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table>';
  md.renderer.rules.table_close = () => "</table></div>";

  const fenceRender = (tokens: Token[], index: number): string => {
    const token = tokens[index];
    const lang = token.info.trim().split(/\s+/)[0];
    if (lang.toLowerCase() === "mermaid") {
      return renderMermaidShell(token.content);
    }
    const label = lang ? `<div class="code-label">${escapeHtml(lang)}</div>` : "";
    return `<div class="code-block">${label}<pre><code>${escapeHtml(token.content)}</code></pre></div>`;
  };
  md.renderer.rules.fence = fenceRender;
  md.renderer.rules.code_block = fenceRender;
}

function renderMarkdown(body: string): string {
  const { markdownBody: bodyWithoutDetails, details } = extractSafeDetails(body);
  const { markdownBody, tables } = extractSafeRawTables(bodyWithoutDetails);
  const html = markdown.render(markdownBody, {});
  return restoreSafeBlocks(restoreSafeRawTables(html, tables), details);
}

interface SafeRawTable {
  placeholder: string;
  html: string;
}

interface SafeRawBlock {
  placeholder: string;
  html: string;
}

const rawDetailsPattern = /<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
const rawTablePattern = /<table\b[\s\S]*?<\/table>/gi;
const allowedTableTags = new Set(["table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col", "br"]);
const allowedTableAttributes = new Set(["align", "colspan", "rowspan", "scope"]);

function extractSafeDetails(body: string): { markdownBody: string; details: SafeRawBlock[] } {
  const details: SafeRawBlock[] = [];
  const markdownBody = body.replace(rawDetailsPattern, (raw, attributes: string, summary: string, content: string) => {
    const open = parseDetailsOpenAttribute(attributes);
    if (open === null) {
      return raw;
    }

    const placeholder = `DIKW_RAW_DETAILS_${details.length}`;
    const renderedContent = renderMarkdown(content.trim());
    details.push({
      placeholder,
      html: `<details class="markdown-details"${open ? " open" : ""}><summary>${escapeHtml(
        summary.trim()
      )}</summary><div class="markdown-details__body">${renderedContent}</div></details>`
    });
    return `\n\n${placeholder}\n\n`;
  });

  return { markdownBody, details };
}

function extractSafeRawTables(body: string): { markdownBody: string; tables: SafeRawTable[] } {
  const tables: SafeRawTable[] = [];
  const markdownBody = body.replace(rawTablePattern, (raw) => {
    const html = sanitizeRawTable(raw);
    if (!html) {
      return raw;
    }
    const placeholder = `DIKW_RAW_TABLE_${tables.length}`;
    tables.push({ placeholder, html });
    return `\n\n${placeholder}\n\n`;
  });

  return { markdownBody, tables };
}

function restoreSafeBlocks(html: string, blocks: SafeRawBlock[]): string {
  return blocks.reduce((current, block) => {
    const paragraphPattern = new RegExp(`<p>\\s*${escapeRegExp(block.placeholder)}\\s*</p>`, "g");
    return current.replace(paragraphPattern, block.html).replaceAll(block.placeholder, block.html);
  }, html);
}

function restoreSafeRawTables(html: string, tables: SafeRawTable[]): string {
  return tables.reduce((current, table) => {
    const paragraphPattern = new RegExp(`<p>\\s*${escapeRegExp(table.placeholder)}\\s*</p>`, "g");
    return current.replace(paragraphPattern, table.html).replaceAll(table.placeholder, table.html);
  }, html);
}

function parseDetailsOpenAttribute(attributes: string): boolean | null {
  const trimmed = attributes.trim();
  if (!trimmed) {
    return false;
  }
  return /^open(?:\s*=\s*(?:"open"|'open'|open|""))?$/i.test(trimmed) ? true : null;
}

function sanitizeRawTable(raw: string): string | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");
  const table = doc.body.firstElementChild;
  if (!(table instanceof HTMLTableElement)) {
    return null;
  }

  sanitizeTableElement(table);
  return `<div class="markdown-table-wrap">${table.outerHTML}</div>`;
}

function sanitizeTableElement(element: Element): void {
  for (const child of Array.from(element.children)) {
    const tagName = child.tagName.toLowerCase();
    if (!allowedTableTags.has(tagName)) {
      child.remove();
      continue;
    }
    sanitizeTableElement(child);
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on") || !allowedTableAttributes.has(name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

function renderMath(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      output: "htmlAndMathml",
      strict: false,
      throwOnError: false,
      trust: false
    });
  } catch {
    const delimiter = displayMode ? "$$" : "$";
    return escapeHtml(`${delimiter}${content}${delimiter}`);
  }
}

function renderMermaidShell(source: string): string {
  return `<div class="mermaid-diagram" data-state="pending" data-mermaid-source="${escapeAttribute(
    encodeURIComponent(source)
  )}"><div class="mermaid-diagram__loading">Rendering diagram...</div><pre class="mermaid-fallback" hidden><code>${escapeHtml(
    source
  )}</code></pre></div>`;
}

let mermaidRenderSequence = 0;

async function renderMermaidDiagrams(root: HTMLElement, isCancelled: () => boolean): Promise<void> {
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>(".mermaid-diagram[data-state='pending']"));
  if (!diagrams.length) {
    return;
  }

  let mermaid: typeof import("mermaid").default;
  try {
    mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: root.ownerDocument.documentElement.dataset.theme === "dark" ? "dark" : "default",
      flowchart: { htmlLabels: false }
    });
  } catch {
    diagrams.forEach((diagram) => renderMermaidFallback(diagram));
    return;
  }

  for (const diagram of diagrams) {
    const source = readMermaidSource(diagram);
    try {
      const id = `dikw-mermaid-${Date.now()}-${mermaidRenderSequence++}`;
      const result = await mermaid.render(id, source);
      if (isCancelled()) {
        return;
      }
      diagram.dataset.state = "rendered";
      diagram.innerHTML = result.svg;
    } catch {
      if (!isCancelled()) {
        renderMermaidFallback(diagram, source);
      }
    }
  }
}

function renderMermaidFallback(diagram: HTMLElement, source = readMermaidSource(diagram)): void {
  diagram.dataset.state = "error";
  diagram.innerHTML = `<div class="mermaid-diagram__error">Mermaid diagram could not be rendered.</div><pre class="code-block mermaid-fallback"><code>${escapeHtml(
    source
  )}</code></pre>`;
}

function readMermaidSource(diagram: HTMLElement): string {
  try {
    return decodeURIComponent(diagram.dataset.mermaidSource ?? "");
  } catch {
    return "";
  }
}

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueHeadingSlug(env: Record<string, unknown>, value: string): string {
  const slug = slugifyHeading(value);
  if (!slug) {
    return "";
  }
  const counts =
    env.headingSlugCounts instanceof Map
      ? env.headingSlugCounts
      : new Map<string, number>();
  env.headingSlugCounts = counts;
  const count = counts.get(slug) ?? 0;
  counts.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count + 1}`;
}

function findDocumentAnchor(root: HTMLElement, rawTarget: string): HTMLElement | null {
  const target = decodeAnchorTarget(rawTarget);
  const exact = root.ownerDocument.getElementById(target);
  if (exact instanceof HTMLElement && root.contains(exact)) {
    return exact;
  }

  const slug = slugifyHeading(target);
  const slugMatch = slug ? root.ownerDocument.getElementById(slug) : null;
  if (slugMatch instanceof HTMLElement && root.contains(slugMatch)) {
    return slugMatch;
  }

  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"));
  return headings.find((heading) => heading.id.startsWith(slug || target)) ?? null;
}

function decodeAnchorTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
