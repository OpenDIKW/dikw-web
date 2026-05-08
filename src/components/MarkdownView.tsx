import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { useMemo } from "react";
import { parseMarkdownDocument, type FrontmatterMeta } from "../utils/markdown";

interface MarkdownViewProps {
  body: string;
  onWikiLink?: (target: string) => void;
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

installWikiLinks(markdown);
installRendererRules(markdown);

export function MarkdownView({ body, onWikiLink }: MarkdownViewProps) {
  const { html, meta } = useMemo(() => {
    const parsed = parseMarkdownDocument(body);
    return {
      html: markdown.render(parsed.body),
      meta: parsed.meta
    };
  }, [body]);

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    const target = element?.dataset.wikiLink;
    if (!target) {
      return;
    }
    event.preventDefault();
    onWikiLink?.(target);
  }

  return (
    <article className="markdown-view" onClick={handleClick}>
      <FrontmatterSummary meta={meta} />
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
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

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noreferrer");
    }
    return defaultRender(tokens, index, options, env, self);
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
