import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { useMemo } from "react";
import { parseMarkdownDocument, type FrontmatterMeta } from "../utils/markdown";

interface MarkdownViewProps {
  body: string;
  fallbackTitle?: string | null;
  onWikiLink?: (target: string) => void;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

installWikiLinks(markdown);
installRendererRules(markdown);

export function MarkdownView({ body, fallbackTitle, onWikiLink }: MarkdownViewProps) {
  const { html, meta, needsFallbackTitle } = useMemo(() => {
    const parsed = parseMarkdownDocument(body, { stripDuplicateTitle: false });
    return {
      html: markdown.render(parsed.body),
      meta: parsed.meta,
      needsFallbackTitle: Boolean(fallbackTitle && !hasTopHeading(parsed.body))
    };
  }, [body, fallbackTitle]);

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
      <FrontmatterSummary meta={meta} />
      {needsFallbackTitle ? <h1 className="markdown-fallback-title">{fallbackTitle}</h1> : null}
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
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
    const label = lang ? `<div class="code-label">${escapeHtml(lang)}</div>` : "";
    return `<div class="code-block">${label}<pre><code>${escapeHtml(token.content)}</code></pre></div>`;
  };
  md.renderer.rules.fence = fenceRender;
  md.renderer.rules.code_block = fenceRender;
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
