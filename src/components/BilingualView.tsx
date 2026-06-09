import { useMemo, useRef } from "react";
import {
  renderMarkdownBlockHtml,
  useMarkdownEffects,
  type MarkdownContext,
} from "./markdown-runtime";

export type BilingualSide = "src" | "tr";

export interface BilingualBlock {
  kind: "text" | "special";
  /** Original markdown for this block (rendered in the left / source column). */
  source: string;
  /**
   * Translated markdown — text blocks only, and only once the translation has
   * arrived. While it is `undefined` (and `translating` is true) the column
   * shows a shimmer skeleton in its place. Special blocks never have one.
   */
  translation?: string;
}

interface BilingualViewProps {
  blocks: BilingualBlock[];
  ctx: MarkdownContext;
  /** True while the (single, whole-document) translation request is in flight. */
  translating: boolean;
  onWikiLink?: (target: string, side: BilingualSide) => void;
  /** Column header labels, resolved to the active locale by the caller. */
  sourceColHead: string;
  trColHead: string;
}

/**
 * Paragraph-aligned dual-column reader. Each text block is rendered once per
 * column (source markdown left, translated markdown right); special blocks
 * (code, tables, charts, display math, rules) render once, centered, and are
 * never translated. Both columns share one post-render hydration pass.
 */
export function BilingualView({
  blocks,
  ctx,
  translating,
  onWikiLink,
  sourceColHead,
  trColHead,
}: BilingualViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => buildStackHtml(blocks, ctx, translating), [blocks, ctx, translating]);
  // Memoize the wrapper object so React's dangerouslySetInnerHTML diff is a
  // no-op when `html` is unchanged — otherwise it would re-set innerHTML and
  // wipe the chart / mermaid / image DOM the effect below hydrates.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  useMarkdownEffects(rootRef, { renderKey: html, assetToken: ctx.assetToken });

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    const node = event.target as HTMLElement;
    const link = node.closest<HTMLElement>("[data-wiki-link]");
    const target = link?.dataset.wikiLink;
    if (target) {
      event.preventDefault();
      const side: BilingualSide = link.closest(".bi-block--tr") ? "tr" : "src";
      onWikiLink?.(target, side);
      return;
    }

    const anchor = node.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    if (href.startsWith("#") && href.length > 1) {
      event.preventDefault();
      const root = rootRef.current;
      const targetEl = root?.ownerDocument.getElementById(decodeAnchorTarget(href.slice(1)));
      if (targetEl && root?.contains(targetEl)) {
        targetEl.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
  }

  return (
    <div className="markdown-body bilingual-cols" ref={rootRef} onClick={handleClick}>
      <div className="bi-colhead" aria-hidden="true">
        <span>{sourceColHead}</span>
        <span>{trColHead}</span>
      </div>
      <div className="bilingual-stack" dangerouslySetInnerHTML={innerHtml} />
    </div>
  );
}

function buildStackHtml(
  blocks: BilingualBlock[],
  ctx: MarkdownContext,
  translating: boolean,
): string {
  // Separate envs per column so heading-slug dedup counters don't bleed across
  // columns; the translated column is prefixed so its ids can't collide with
  // the source column's in the same DOM.
  const srcEnv: Record<string, unknown> = {};
  const trEnv: Record<string, unknown> = { headingSlugPrefix: "tr-" };

  return blocks
    .map((block) => {
      const srcHtml = renderMarkdownBlockHtml(block.source, ctx, srcEnv);
      if (block.kind === "special") {
        return `<div class="bi-pair--special"><div class="bi-special">${srcHtml}</div></div>`;
      }
      const trHtml =
        block.translation !== undefined
          ? renderMarkdownBlockHtml(block.translation, ctx, trEnv)
          : "";
      return (
        `<div class="bi-pair${translating ? " is-loading" : ""}">` +
        `<div class="bi-block bi-block--src">${srcHtml}</div>` +
        `<div class="bi-block bi-block--tr">` +
        `<div class="bi-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>` +
        `<div class="bi-tr-text">${trHtml}</div>` +
        `</div></div>`
      );
    })
    .join("");
}

function decodeAnchorTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
