import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { useEffect, useMemo, useRef } from "react";
import {
  parseDetailsOpenAttribute,
  parseMarkdownDocument,
  rawDetailsPattern,
  slugifyHeading,
  uniqueHeadingSlug,
  type FrontmatterMeta,
} from "../utils/markdown";
import type { PageAsset } from "../types";
import {
  buildChartOption,
  isChartSpec,
  isChartType,
  parseChartFromDetails,
  type ChartType,
} from "../utils/chart-spec";
import { buildRequestUrl } from "../api/client";
import { basename } from "../utils/format";
import { isRemoteRef } from "../utils/md-asset-refs";

interface MarkdownViewProps {
  body: string;
  fallbackTitle?: string | null;
  onWikiLink?: (target: string) => void;
  showFrontmatter?: boolean;
  assets?: PageAsset[];
  assetBaseUrl?: string;
  assetToken?: string;
}

interface MarkdownContext {
  assets: PageAsset[];
  assetBaseUrl: string;
  assetToken: string;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

installWikiLinks(markdown);
installMath(markdown);
installObsidianImages(markdown);
installStandardImages(markdown);
installRendererRules(markdown);

export function MarkdownView({
  body,
  fallbackTitle,
  onWikiLink,
  showFrontmatter = true,
  assets,
  assetBaseUrl,
  assetToken,
}: MarkdownViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const ctx = useMemo<MarkdownContext>(
    () => ({
      assets: assets ?? [],
      assetBaseUrl: assetBaseUrl ?? "",
      assetToken: assetToken ?? "",
    }),
    [assets, assetBaseUrl, assetToken],
  );
  const { html, meta, needsFallbackTitle } = useMemo(() => {
    const parsed = parseMarkdownDocument(body, { stripDuplicateTitle: false });
    return {
      html: renderMarkdown(parsed.body, ctx),
      meta: parsed.meta,
      needsFallbackTitle: Boolean(fallbackTitle && !hasTopHeading(parsed.body)),
    };
  }, [body, ctx, fallbackTitle]);

  // React diffs `dangerouslySetInnerHTML` by the wrapping object's identity, not
  // by `__html` string equality, so a fresh `{ __html: html }` literal on every
  // render makes React re-set `innerHTML` on every parent state change — which
  // wipes any DOM mutations from mermaid / chart / image hydration done in the
  // effect below. Memoize the wrapper so the diff is a no-op when `html` stays
  // the same value.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) {
      return;
    }
    let cancelled = false;
    void renderMermaidDiagrams(root, () => cancelled);
    const disposeCharts = renderMarkdownCharts(root);
    const disposeImages = hydrateAuthenticatedImages(root, ctx.assetToken);
    return () => {
      cancelled = true;
      disposeCharts();
      disposeImages();
    };
  }, [html, ctx.assetToken]);

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
      <div ref={bodyRef} className="markdown-body" dangerouslySetInnerHTML={innerHtml} />
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
    ["status", meta.status],
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
      target,
    )}">${escapeHtml(token.content)}</button>`;
  };
}

function installObsidianImages(md: MarkdownIt) {
  md.inline.ruler.before("emphasis", "obsidian_image", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x21) {
      return false;
    }
    if (src.charCodeAt(start + 1) !== 0x5b || src.charCodeAt(start + 2) !== 0x5b) {
      return false;
    }
    const close = src.indexOf("]]", start + 3);
    if (close < 0) {
      return false;
    }
    if (!silent) {
      const raw = src.slice(start + 3, close).trim();
      const [pathPart, altPart] = raw.split("|", 2);
      const path = pathPart.trim();
      const alt = (altPart ?? "").trim();
      const token = state.push("obsidian_image", "", 0);
      token.attrSet("data-path", path);
      if (alt) {
        token.attrSet("data-alt", alt);
      }
    }
    state.pos = close + 2;
    return true;
  });

  md.renderer.rules.obsidian_image = (tokens, index, _options, env) => {
    const token = tokens[index];
    const path = token.attrGet("data-path") ?? "";
    const alt = token.attrGet("data-alt") ?? "";
    const ctx = (env as { dikwContext?: MarkdownContext })?.dikwContext;
    const resolved = resolveAssetUrl(path, ctx);
    if (!resolved) {
      return `<span class="md-broken-image" title="asset not found">⚠ ${escapeHtml(path)}</span>`;
    }
    const altText = alt || basename(path);
    if (ctx?.assetToken) {
      return `<img class="markdown-image" data-asset-src="${escapeAttribute(
        resolved,
      )}" alt="${escapeAttribute(altText)}" loading="lazy" />`;
    }
    return `<img class="markdown-image" src="${escapeAttribute(resolved)}" alt="${escapeAttribute(
      altText,
    )}" loading="lazy" />`;
  };
}

// Standard CommonMark image syntax (``![alt](path)`` / ``![alt](path "title")``).
// Mirrors installObsidianImages but works on markdown-it's default ``image`` token
// so local refs land on /v1/assets/<id> instead of leaking to the SPA host.
//
// Accepts ``self: Renderer`` as the 5th argument so we can reuse
// ``renderInlineAsText`` for alt — markdown-it's default behavior is to strip
// inline markup from alt (CommonMark spec); a hand-rolled ``token.content``
// would leak literal ``**`` / ``_`` into screen readers.
function installStandardImages(md: MarkdownIt) {
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const src = token.attrGet("src") ?? "";
    const title = token.attrGet("title") ?? "";
    const ctx = (env as { dikwContext?: MarkdownContext })?.dikwContext;
    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";

    // Empty src (``![]()``) and whitespace-only refs are common in drafts and
    // tool-generated markdown — render nothing rather than a noisy ⚠ marker.
    if (!src.trim()) {
      return "";
    }

    if (isRemoteRef(src)) {
      // ``http(s)://``, ``data:``, etc. pass through verbatim — these aren't
      // tracked in PageAsset.original_paths. ``markdown-image`` class IS kept
      // so the CSS in src/styles.css applies uniformly; the auth-hydration
      // selector requires ``data-asset-src`` (absent here), so it stays inert.
      return `<img class="markdown-image" src="${escapeAttribute(
        src,
      )}" alt="${escapeAttribute(alt)}"${titleAttr} loading="lazy" />`;
    }

    // Two-stage lookup: literal src first, then percent-decoded fallback.
    // markdown-it normalizeLink percent-encodes non-ASCII characters in
    // standard ``![](path)`` syntax (e.g. ``./封面.png`` → ``./%E5…``) but
    // PageAsset.original_paths stores the raw author input by core's
    // md_inspect. The decode retry is intentionally scoped to this site, NOT
    // pushed into resolveAssetUrl, so Obsidian ``![[...]]`` resolution stays
    // verbatim (its parser doesn't percent-encode and shouldn't get the
    // cross-syntax leniency).
    const decoded = decodePathForDisplay(src);
    const resolved =
      resolveAssetUrl(src, ctx) ?? (decoded !== src ? resolveAssetUrl(decoded, ctx) : null);
    if (!resolved) {
      // Echo the decoded form so the user sees what they wrote, not
      // ``%E5%B0%81…``.
      return `<span class="md-broken-image" title="asset not found">⚠ ${escapeHtml(
        decoded,
      )}</span>`;
    }
    if (ctx?.assetToken) {
      return `<img class="markdown-image" data-asset-src="${escapeAttribute(
        resolved,
      )}" alt="${escapeAttribute(alt)}"${titleAttr} loading="lazy" />`;
    }
    return `<img class="markdown-image" src="${escapeAttribute(
      resolved,
    )}" alt="${escapeAttribute(alt)}"${titleAttr} loading="lazy" />`;
  };
}

/** Decode percent-escapes safely for display; if the string is malformed
 *  (rare — markdown-it produces well-formed encoding) return the raw input. */
function decodePathForDisplay(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

const SHA256_IN_PATH = /(?:^|\/)([0-9a-f]{64})\.[a-z0-9]+$/i;

function resolveAssetUrl(path: string, ctx: MarkdownContext | undefined): string | null {
  if (!ctx || !ctx.assets.length) {
    return null;
  }
  const direct = ctx.assets.find((asset) => asset.original_paths.includes(path));
  if (direct) {
    return buildRequestUrl(ctx.assetBaseUrl, direct.url);
  }
  const hashMatch = path.match(SHA256_IN_PATH);
  if (hashMatch) {
    const byId = ctx.assets.find((asset) => asset.asset_id === hashMatch[1]);
    if (byId) {
      return buildRequestUrl(ctx.assetBaseUrl, byId.url);
    }
  }
  return null;
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
      let content: string;
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
    { alt: ["paragraph", "reference", "blockquote", "list"] },
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

function renderMarkdown(body: string, ctx: MarkdownContext): string {
  const { markdownBody: bodyWithoutDetails, details } = extractSafeDetails(body, ctx);
  const { markdownBody, tables } = extractSafeRawTables(bodyWithoutDetails);
  const html = markdown.render(markdownBody, { dikwContext: ctx });
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

const rawTablePattern = /<table\b[\s\S]*?<\/table>/gi;
const allowedTableTags = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "br",
]);
const allowedTableAttributes = new Set(["align", "colspan", "rowspan", "scope"]);

function extractSafeDetails(
  body: string,
  ctx: MarkdownContext,
): { markdownBody: string; details: SafeRawBlock[] } {
  const details: SafeRawBlock[] = [];
  const markdownBody = body.replace(
    rawDetailsPattern,
    (raw, attributes: string, summary: string, content: string) => {
      const open = parseDetailsOpenAttribute(attributes);
      if (open === null) {
        return raw;
      }

      const summaryText = summary.trim();
      const summaryLower = summaryText.toLowerCase();
      const trimmedContent = content.trim();
      const placeholder = `DIKW_RAW_DETAILS_${details.length}`;

      if (isChartType(summaryLower)) {
        const chartHtml = tryRenderChartPlaceholder(summaryLower as ChartType, trimmedContent);
        if (chartHtml) {
          details.push({ placeholder, html: chartHtml });
          return `\n\n${placeholder}\n\n`;
        }
      }

      const renderedContent = renderMarkdown(trimmedContent, ctx);
      details.push({
        placeholder,
        html: `<details class="markdown-details"${open ? " open" : ""}><summary>${escapeHtml(
          summaryText,
        )}</summary><div class="markdown-details__body">${renderedContent}</div></details>`,
      });
      return `\n\n${placeholder}\n\n`;
    },
  );

  return { markdownBody, details };
}

function tryRenderChartPlaceholder(type: ChartType, content: string): string | null {
  const spec = parseChartFromDetails(content, type);
  if (!spec) {
    return null;
  }
  const encoded = encodeChartSpec(spec);
  const caption = spec.freeText.length
    ? `<div class="markdown-chart__caption">${spec.freeText.map(escapeHtml).join("<br/>")}</div>`
    : "";
  return `<div class="markdown-chart" data-chart-type="${escapeAttribute(type)}" data-chart-spec="${escapeAttribute(
    encoded,
  )}" role="img" aria-label="${escapeAttribute(type)} chart"><div class="markdown-chart__canvas"></div>${caption}</div>`;
}

function encodeChartSpec(spec: object): string {
  const json = JSON.stringify(spec);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeChartSpec(encoded: string): unknown {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
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
      trust: false,
    });
  } catch {
    const delimiter = displayMode ? "$$" : "$";
    return escapeHtml(`${delimiter}${content}${delimiter}`);
  }
}

function renderMermaidShell(source: string): string {
  return `<div class="mermaid-diagram" data-state="pending" data-mermaid-source="${escapeAttribute(
    encodeURIComponent(source),
  )}"><div class="mermaid-diagram__loading">Rendering diagram...</div><pre class="mermaid-fallback" hidden><code>${escapeHtml(
    source,
  )}</code></pre></div>`;
}

let mermaidRenderSequence = 0;

async function renderMermaidDiagrams(root: HTMLElement, isCancelled: () => boolean): Promise<void> {
  const diagrams = Array.from(
    root.querySelectorAll<HTMLElement>(".mermaid-diagram[data-state='pending']"),
  );
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
      flowchart: { htmlLabels: false },
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

function renderMarkdownCharts(root: HTMLElement): () => void {
  const placeholders = Array.from(
    root.querySelectorAll<HTMLElement>(".markdown-chart[data-chart-spec]"),
  );
  if (!placeholders.length) {
    return () => {};
  }

  const instances: Array<{ dispose: () => void }> = [];
  let cancelled = false;

  void (async () => {
    let echarts: typeof import("echarts/core");
    try {
      const [core, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      echarts = core;
      echarts.use([
        charts.BarChart,
        charts.LineChart,
        charts.ScatterChart,
        charts.HeatmapChart,
        components.GridComponent,
        components.TooltipComponent,
        components.TitleComponent,
        components.VisualMapComponent,
        renderers.CanvasRenderer,
      ]);
    } catch {
      for (const el of placeholders) {
        renderChartFallback(el);
      }
      return;
    }
    if (cancelled) {
      return;
    }
    const theme = root.ownerDocument.documentElement.dataset.theme === "dark" ? "dark" : undefined;
    for (const el of placeholders) {
      if (cancelled) {
        return;
      }
      const encoded = el.dataset.chartSpec ?? "";
      const type = el.dataset.chartType ?? "";
      if (!encoded || !isChartType(type)) {
        renderChartFallback(el);
        continue;
      }
      const canvas = el.querySelector<HTMLElement>(".markdown-chart__canvas") ?? el;
      try {
        const decoded = decodeChartSpec(encoded);
        if (!isChartSpec(decoded)) {
          throw new Error("invalid chart spec");
        }
        const instance = echarts.init(canvas, theme);
        instances.push(instance);
        instance.setOption(buildChartOption(decoded));
        el.dataset.state = "rendered";
      } catch {
        renderChartFallback(el);
      }
    }
  })();

  return () => {
    cancelled = true;
    for (const instance of instances) {
      try {
        instance.dispose();
      } catch {
        //
      }
    }
  };
}

function renderChartFallback(el: HTMLElement): void {
  el.dataset.state = "error";
  const encoded = el.dataset.chartSpec ?? "";
  const type = el.dataset.chartType ?? "chart";
  if (!encoded) {
    return;
  }
  try {
    const decoded = decodeChartSpec(encoded);
    if (!isChartSpec(decoded)) {
      return;
    }
    el.innerHTML = renderChartFallbackHtml(type, decoded);
  } catch {
    /* leave shell as-is */
  }
}

function renderChartFallbackHtml(
  type: string,
  spec: { headers: string[]; rows: string[][] },
): string {
  const head = spec.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
  const body = spec.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const table = `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  return `<details class="markdown-details" open><summary>${escapeHtml(
    type,
  )}</summary><div class="markdown-details__body">${table}</div></details>`;
}

function hydrateAuthenticatedImages(root: HTMLElement, token: string): () => void {
  if (!token) {
    return () => {};
  }
  const images = Array.from(
    root.querySelectorAll<HTMLImageElement>("img.markdown-image[data-asset-src]"),
  );
  if (!images.length) {
    return () => {};
  }
  const blobUrls: string[] = [];
  const controller = new AbortController();

  void (async () => {
    for (const img of images) {
      if (controller.signal.aborted) {
        return;
      }
      const url = img.dataset.assetSrc;
      if (!url) {
        continue;
      }
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`asset ${response.status}`);
        }
        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        blobUrls.push(objectUrl);
        img.src = objectUrl;
      } catch {
        img.dataset.assetState = "error";
      }
    }
  })();

  return () => {
    controller.abort();
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
  };
}

function renderMermaidFallback(diagram: HTMLElement, source = readMermaidSource(diagram)): void {
  diagram.dataset.state = "error";
  diagram.innerHTML = `<div class="mermaid-diagram__error">Mermaid diagram could not be rendered.</div><pre class="code-block mermaid-fallback"><code>${escapeHtml(
    source,
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

  const headings = Array.from(
    root.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
  );
  return headings.find((heading) => heading.id.startsWith(slug || target)) ?? null;
}

function decodeAnchorTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
