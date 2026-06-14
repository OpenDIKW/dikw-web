import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { DikwClient } from "../api/client";
import { MarkdownView } from "../components/MarkdownView";
import {
  renderMarkdownBlockHtml,
  useMarkdownEffects,
  type MarkdownContext,
} from "../components/markdown-runtime";
import type { BilingualBlock } from "../components/BilingualView";
import { useBilingualReader } from "../hooks/useBilingualReader";
import type { TranslateCache } from "../utils/translate";
import { isEnglishBody } from "../utils/lang";
import { parseMarkdownDocument } from "../utils/markdown";
import { basename } from "../utils/format";
import type { PageReadResult } from "../types";
import type { CurrentPaper } from "./MbApp";

interface Props {
  paper: CurrentPaper | null;
  client: DikwClient;
  assetBaseUrl: string;
  assetToken: string;
  translatorEnabled: boolean;
  translateCache: TranslateCache | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onUpload: () => void;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function PaperReader({
  paper,
  client,
  assetBaseUrl,
  assetToken,
  translatorEnabled,
  translateCache,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  onUpload,
}: Props) {
  const [page, setPage] = useState<PageReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const path = paper?.path ?? null;
  useEffect(() => {
    if (!path) {
      setPage(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(path)}`, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setPage(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setPage(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, path]);

  const readerBody = useMemo(
    () => (page ? parseMarkdownDocument(page.body, { stripDuplicateTitle: false }).body : ""),
    [page],
  );
  const isEnglish = useMemo(() => isEnglishBody(readerBody), [readerBody]);
  const bilingual = useBilingualReader({
    body: readerBody,
    enabled: translatorEnabled,
    cache: translateCache,
  });
  const canBilingual = translatorEnabled && isEnglish;
  const ctx: MarkdownContext = useMemo(
    () => ({ assets: page?.assets ?? [], assetBaseUrl, assetToken }),
    [page?.assets, assetBaseUrl, assetToken],
  );

  function selectSrc() {
    if (bilingual.active) bilingual.toggle();
  }
  function selectBi() {
    if (!canBilingual) return;
    if (!bilingual.active) bilingual.toggle();
  }

  const title = paper?.title || page?.title || (page ? basename(page.path) : "");

  return (
    <section className="mb-col mb-reader">
      <div className="mb-reader-in">
        <div className="mb-r-tools">
          <button
            type="button"
            className={`mb-ptoggle${leftCollapsed ? "" : " on"}`}
            onClick={onToggleLeft}
            aria-label={leftCollapsed ? "展开论文库" : "折叠论文库"}
            title={leftCollapsed ? "展开论文库" : "折叠论文库"}
          >
            {leftCollapsed ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </button>

          {page ? (
            <div className="mb-seg" role="tablist" aria-label="阅读模式">
              <button
                type="button"
                role="tab"
                aria-selected={!bilingual.active}
                className={!bilingual.active ? "on" : ""}
                onClick={selectSrc}
              >
                原文
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bilingual.active}
                className={bilingual.active ? "on" : ""}
                onClick={selectBi}
                disabled={!canBilingual}
                title={canBilingual ? "中英对照" : "需要英文论文且已配置翻译服务"}
              >
                中英对照
              </button>
            </div>
          ) : null}

          <div style={{ flex: 1 }} />

          <button
            type="button"
            className={`mb-ptoggle${rightCollapsed ? "" : " on"}`}
            onClick={onToggleRight}
            aria-label={rightCollapsed ? "展开知识问答" : "折叠知识问答"}
            title={rightCollapsed ? "展开知识问答" : "折叠知识问答"}
          >
            {rightCollapsed ? (
              <PanelRightOpen size={18} aria-hidden="true" />
            ) : (
              <PanelRightClose size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        {!path ? (
          <div className="mb-reader-empty">
            <FileUp size={46} aria-hidden="true" />
            <div className="t">选择一篇论文开始阅读</div>
            <div className="s">从左侧论文库点选，或上传新的 PDF 自动入库</div>
            <button className="mb-btn pri" type="button" onClick={onUpload}>
              <FileUp size={16} aria-hidden="true" />
              上传论文
            </button>
          </div>
        ) : loading ? (
          <div className="mb-reader-empty">
            <Loader2 className="mb-spin" size={40} aria-hidden="true" />
            <div className="t">正在加载论文…</div>
          </div>
        ) : error ? (
          <div className="mb-reader-empty">
            <div className="t">论文加载失败</div>
            <div className="s">请稍后重试，或确认 dikw-core 连接正常。</div>
          </div>
        ) : page ? (
          <>
            <h1 className="mb-r-title">{title}</h1>
            <div className="mb-r-meta">{page.path}</div>
            {bilingual.active ? (
              <>
                <BilingualStatus
                  translating={bilingual.translating}
                  cached={bilingual.cached}
                  hasError={!!bilingual.error}
                  onRetranslate={bilingual.forceRetranslate}
                  onCancel={bilingual.cancel}
                />
                <BilingualPaper
                  blocks={bilingual.blocks}
                  translating={bilingual.translating}
                  ctx={ctx}
                />
              </>
            ) : (
              <MarkdownView
                body={page.body}
                fallbackTitle={title}
                showFrontmatter={false}
                assets={page.assets}
                assetBaseUrl={assetBaseUrl}
                assetToken={assetToken}
              />
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function BilingualStatus({
  translating,
  cached,
  hasError,
  onRetranslate,
  onCancel,
}: {
  translating: boolean;
  cached: boolean;
  hasError: boolean;
  onRetranslate: () => void;
  onCancel: () => void;
}) {
  if (hasError) {
    return (
      <div className="mb-bi-status err" role="status" aria-live="polite">
        <span className="left">翻译失败</span>
        <button type="button" onClick={onRetranslate}>
          重试
        </button>
      </div>
    );
  }
  if (translating) {
    return (
      <div className="mb-bi-status" role="status" aria-live="polite">
        <span className="left">
          <Loader2 className="mb-spin" size={14} aria-hidden="true" />
          翻译中…
        </span>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    );
  }
  return (
    <div className="mb-bi-status" role="status" aria-live="polite">
      <span className="left">
        中英对照
        {cached ? <span className="mb-chip-cached">缓存</span> : null}
      </span>
      <button type="button" onClick={onRetranslate}>
        再翻译一次
      </button>
    </div>
  );
}

// Memoized so a parent re-render (e.g. MbApp's selection chip state changing)
// doesn't rebuild the dual-column DOM. Rebuilding replaces the paragraphs' text
// nodes, which clears the native selection AND collapses the staged CSS Custom
// Highlight range — that was why a selection's yellow vanished on release in the
// bilingual view. Props (blocks / translating / ctx) are referentially stable
// between such re-renders, so this skips them; a real content change still
// re-renders.
const BilingualPaper = memo(function BilingualPaper({
  blocks,
  translating,
  ctx,
}: {
  blocks: BilingualBlock[];
  translating: boolean;
  ctx: MarkdownContext;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverPi, setHoverPi] = useState<number | null>(null);

  const rows = useMemo(() => {
    const srcEnv: Record<string, unknown> = {};
    const trEnv: Record<string, unknown> = { headingSlugPrefix: "tr-" };
    return blocks.map((b, idx) => {
      if (b.kind === "special") {
        return {
          kind: "special" as const,
          i: idx,
          srcHtml: renderMarkdownBlockHtml(b.source, ctx, srcEnv),
        };
      }
      return {
        kind: "text" as const,
        i: idx,
        srcHtml: renderMarkdownBlockHtml(b.source, ctx, srcEnv),
        trHtml:
          b.translation !== undefined ? renderMarkdownBlockHtml(b.translation, ctx, trEnv) : "",
        loading: b.translation === undefined && translating,
      };
    });
  }, [blocks, translating, ctx]);

  const renderKey = useMemo(
    () =>
      rows.map((r) => (r.kind === "special" ? `s${r.i}` : `t${r.i}:${r.trHtml.length}`)).join("|"),
    [rows],
  );
  useMarkdownEffects(ref, { renderKey, assetToken: ctx.assetToken });

  return (
    <div className="mb-cols bi" ref={ref}>
      <div className="mb-lab">EN · 原文</div>
      <div className="mb-lab">中文</div>
      {rows.map((r) =>
        r.kind === "special" ? (
          <div
            key={r.i}
            className="mb-bp mb-special"
            dangerouslySetInnerHTML={{ __html: r.srcHtml }}
          />
        ) : (
          <Fragment key={r.i}>
            <div
              className={`mb-bp en${hoverPi === r.i ? " hl" : ""}`}
              data-pi={r.i}
              onMouseEnter={() => setHoverPi(r.i)}
              onMouseLeave={() => setHoverPi(null)}
              dangerouslySetInnerHTML={{ __html: r.srcHtml }}
            />
            {r.loading ? (
              <div
                className={`mb-bp${hoverPi === r.i ? " hl" : ""}`}
                data-pi={r.i}
                onMouseEnter={() => setHoverPi(r.i)}
                onMouseLeave={() => setHoverPi(null)}
              >
                <span className="mb-skel" />
              </div>
            ) : (
              <div
                className={`mb-bp${hoverPi === r.i ? " hl" : ""}`}
                data-pi={r.i}
                onMouseEnter={() => setHoverPi(r.i)}
                onMouseLeave={() => setHoverPi(null)}
                dangerouslySetInnerHTML={{ __html: r.trHtml }}
              />
            )}
          </Fragment>
        ),
      )}
    </div>
  );
});
