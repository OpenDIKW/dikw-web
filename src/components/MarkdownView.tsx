import { useMemo, useRef } from "react";
import { parseMarkdownDocument, slugifyHeading, type FrontmatterMeta } from "../utils/markdown";
import type { PageAsset } from "../types";
import { renderMarkdown, useMarkdownEffects, type MarkdownContext } from "./markdown-runtime";

interface MarkdownViewProps {
  body: string;
  fallbackTitle?: string | null;
  onWikiLink?: (target: string) => void;
  showFrontmatter?: boolean;
  assets?: PageAsset[];
  assetBaseUrl?: string;
  assetToken?: string;
}

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

  useMarkdownEffects(bodyRef, { renderKey: html, assetToken: ctx.assetToken });

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

function asList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
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
