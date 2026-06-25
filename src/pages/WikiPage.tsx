import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { EmptyState } from "../components/EmptyState";
import { FrontmatterChip } from "../components/FrontmatterChip";
import { MarkdownView } from "../components/MarkdownView";
import { BilingualView, type BilingualSide } from "../components/BilingualView";
import { Notice } from "../components/Notice";
import { SoftLabel } from "../components/SoftLabel";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { useBilingualReader, type BilingualReader } from "../hooks/useBilingualReader";
import { usePreviewTranslation } from "../hooks/usePreviewTranslation";
import { isEnglishBody } from "../utils/lang";
import {
  fetchTranslateEnabled,
  tryOpenDefaultTranslateCache,
  type TranslateCache,
} from "../utils/translate";
import { translations, type Locale } from "../i18n";
import type {
  DocumentRecord,
  PageLinksResult,
  PageProvenanceResult,
  PageReadResult,
} from "../types";
import { findPageForTarget } from "../utils/graph";
import {
  mergeSourceReferences,
  resolveBacklinks,
  resolveDerivedPages,
  type SourceReference,
} from "../utils/links";
import {
  extractHeadingsWithSlugs,
  getMarkdownTitle,
  parseMarkdownDocument,
  type HeadingEntry,
} from "../utils/markdown";
import { basename, displayTitle, formatUnixSeconds, truncateMiddle } from "../utils/format";
import { injectInlineRefs } from "../utils/source-inline-refs";

interface WikiPageProps {
  client: DikwClient;
  initialPath?: string | null;
  locale?: Locale;
  assetBaseUrl?: string;
  assetToken?: string;
}

interface WikiTreeNode {
  id: string;
  name: string;
  children: WikiTreeNode[];
  doc: DocumentRecord | null;
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading"; target: string; doc: DocumentRecord; side?: BilingualSide }
  | {
      kind: "ready";
      target: string;
      doc: DocumentRecord;
      page: PageReadResult;
      side?: BilingualSide;
    }
  | { kind: "not-found"; target: string }
  | { kind: "error"; target: string; error: unknown };

type WikiReaderTab = "read" | "info" | "outline" | "source";
type WikiCopy = (typeof translations)["en"]["pages"]["wiki"];

// Directory column is user-resizable (drag the gap splitter or arrow-key the
// focused separator) so long filenames fit; the width persists across sessions.
const WIKI_SIDEBAR_WIDTH_KEY = "dikw-web.wikiSidebarWidth";
const WIKI_SIDEBAR_MIN_WIDTH = 240;
const WIKI_SIDEBAR_MAX_WIDTH = 640;
const WIKI_SIDEBAR_DEFAULT_WIDTH = 300;
const WIKI_SIDEBAR_STEP = 16;

function clampSidebarWidth(width: number): number {
  return Math.min(WIKI_SIDEBAR_MAX_WIDTH, Math.max(WIKI_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readWikiSidebarWidth(): number {
  const raw = Number(localStorage.getItem(WIKI_SIDEBAR_WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : WIKI_SIDEBAR_DEFAULT_WIDTH;
}

export function WikiPage({
  client,
  initialPath,
  locale = "en",
  assetBaseUrl = "",
  assetToken = "",
}: WikiPageProps) {
  const copy = translations[locale].pages.wiki;
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [page, setPage] = useState<PageReadResult | null>(null);
  const [pageError, setPageError] = useState<unknown>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageReloadId, setPageReloadId] = useState(0);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [backlinks, setBacklinks] = useState<PageLinksResult | null>(null);
  const [derived, setDerived] = useState<PageProvenanceResult | null>(null);
  const previewRequestIdRef = useRef(0);
  const didAutoSelectRef = useRef(false);
  const [translatorEnabled, setTranslatorEnabled] = useState(false);
  const [translateCache, setTranslateCache] = useState<TranslateCache | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => readWikiSidebarWidth());
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(WIKI_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  // Keep the col-resize cursor and suppress text selection document-wide while
  // a drag is in flight, then clean up when it ends.
  useEffect(() => {
    if (!resizingSidebar) return undefined;
    document.body.classList.add("is-col-resizing");
    return () => document.body.classList.remove("is-col-resizing");
  }, [resizingSidebar]);

  // Probe the sidecar translator once on mount; gates the Base reader's AI
  // translate toggle. Open the IndexedDB cache lazily (and only once enabled)
  // so repeat translations of the same page are instant.
  useEffect(() => {
    let cancelled = false;
    void fetchTranslateEnabled().then((enabled) => {
      if (cancelled) return;
      setTranslatorEnabled(enabled);
      if (enabled) {
        void tryOpenDefaultTranslateCache().then((cache) => {
          if (!cancelled) setTranslateCache(cache);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPages = useCallback(
    (signal: AbortSignal) =>
      client.get<DocumentRecord[]>("/v1/base/pages", { signal, params: { active: true } }),
    [client],
  );
  const pages = useAsyncResource(loadPages, [client]);

  useEffect(() => {
    if (initialPath) {
      didAutoSelectRef.current = true;
      setSelectedPath(initialPath);
    }
  }, [initialPath]);

  // Base view shows only the source + knowledge layers; wisdom has its own
  // #wisdom page. Filter once here and reuse `basePages` for every lookup
  // (tree, default selection, backlinks/provenance joins, wikilink preview,
  // file count) so wisdom can't leak into #base through a join or preview.
  const basePages = useMemo(
    () => (pages.data ?? []).filter((doc) => doc.layer === "source" || doc.layer === "knowledge"),
    [pages.data],
  );

  const visiblePages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return basePages;
    }
    return basePages.filter((doc) => {
      const haystack = `${doc.path} ${doc.title ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, basePages]);

  const tree = useMemo(() => buildWikiTree(visiblePages), [visiblePages]);
  const expandedTreeIds = useMemo(() => {
    const next = new Set(expandedDirs);
    const pathForExpansion = selectedPath;
    if (filter.trim()) {
      collectDirectoryIds(tree, next);
    }
    if (pathForExpansion) {
      collectPathAncestors(pathForExpansion).forEach((id) => next.add(id));
    }
    for (const node of tree) {
      if (!node.doc) {
        next.add(node.id);
      }
    }
    return next;
  }, [expandedDirs, filter, selectedPath, tree]);

  useEffect(() => {
    if (!pages.data) {
      return;
    }
    const nextSelectedPath = pickDefaultPagePath(visiblePages);
    if (!nextSelectedPath) {
      setSelectedPath(null);
      didAutoSelectRef.current = false;
      return;
    }
    if (selectedPath && !visiblePages.some((doc) => doc.path === selectedPath)) {
      setSelectedPath(nextSelectedPath);
      didAutoSelectRef.current = true;
      return;
    }
    if (!selectedPath && !didAutoSelectRef.current) {
      setSelectedPath(nextSelectedPath);
      didAutoSelectRef.current = true;
    }
  }, [pages.data, selectedPath, visiblePages]);

  useEffect(() => {
    if (!selectedPath) {
      setPage(null);
      return;
    }
    const controller = new AbortController();
    setPageLoading(true);
    setPageError(null);
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(selectedPath)}`, {
        signal: controller.signal,
      })
      .then((nextPage) => {
        if (!controller.signal.aborted) {
          setPage(nextPage);
        }
      })
      .catch((nextError: unknown) => {
        if (!controller.signal.aborted) {
          setPageError(nextError);
          setPage(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPageLoading(false);
        }
      });
    return () => controller.abort();
  }, [client, pageReloadId, selectedPath]);

  // Source pages carry no `[[...]]` of their own (the curated links live in the
  // K/W layer pointing down at them), so surface their backlinks instead. Only
  // fetch for source pages; other layers already render their links inline.
  const loadedPath = page?.path;
  const loadedLayer = page?.layer;
  useEffect(() => {
    if (!loadedPath || loadedLayer !== "source") {
      setBacklinks(null);
      return;
    }
    const controller = new AbortController();
    client
      .get<PageLinksResult>(`/v1/base/pages/${encodePath(loadedPath)}/links`, {
        signal: controller.signal,
        params: { direction: "in" },
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setBacklinks(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBacklinks(null);
        }
      });
    return () => controller.abort();
  }, [client, loadedPath, loadedLayer, pageReloadId]);

  // K-page frontmatter `sources:` is a second, independent reverse-edge channel
  // alongside body wikilinks. Pre-0.2.6 cores have no /provenance endpoint and
  // return 404 — silently degrade to /links-only. Other failures (5xx, network)
  // also clear the channel but surface a warning so the user / dev sees that
  // provenance is missing, instead of guessing at a quiet UI.
  useEffect(() => {
    if (!loadedPath || loadedLayer !== "source") {
      setDerived(null);
      return;
    }
    const controller = new AbortController();
    client
      .get<PageProvenanceResult>(`/v1/base/pages/${encodePath(loadedPath)}/provenance`, {
        signal: controller.signal,
        params: { direction: "in" },
      })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        // Layer-safety invariant the core contract documents: a source page's
        // `derived_from` should be empty (provenance points outward, not into
        // a source). Warn instead of silently dropping, so a future regression
        // in core is visible in dev tooling.
        if (result.derived_from.length > 0 && typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn(
            `[wiki] /provenance for source page ${loadedPath} returned ${result.derived_from.length} derived_from entries; core contract says this should be empty.`,
          );
        }
        setDerived(result);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDerived(null);
        // 404 / 405 are the documented pre-0.2.6 fallback path — silent on
        // purpose. Anything else (5xx, network, parse error) leaves a console
        // warning so the disappearance is debuggable.
        const status = error instanceof DikwClientError ? error.status : null;
        if (status !== 404 && status !== 405 && typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn(`[wiki] /provenance for ${loadedPath} failed:`, error);
        }
      });
    return () => controller.abort();
  }, [client, loadedPath, loadedLayer, pageReloadId]);

  // Source→source navigation: clear the prior page's reverse-edge state up
  // front so the merged panel never shows stale chips during the body-fetch
  // → setPage → effects-rerun window. Race guards in the memo still protect
  // against late-arriving in-flight responses.
  useEffect(() => {
    setBacklinks(null);
    setDerived(null);
  }, [selectedPath]);

  function refreshWiki() {
    pages.reload();
    if (selectedPath) {
      setPageReloadId((value) => value + 1);
    }
  }

  function toggleDirectory(id: string) {
    const isClosing = expandedTreeIds.has(id);
    setExpandedDirs((value) => {
      const next = new Set(value);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (isClosing && selectedPath && pathIsInsideDirectory(selectedPath, id)) {
        collectPathAncestors(selectedPath).forEach((ancestorId) => {
          if (ancestorId !== id) {
            next.add(ancestorId);
          }
        });
        next.delete(id);
      }
      return next;
    });
    if (isClosing && selectedPath && pathIsInsideDirectory(selectedPath, id)) {
      clearReader();
    }
  }

  function selectPage(path: string) {
    didAutoSelectRef.current = true;
    setSelectedPath(path);
  }

  function previewByPath(path: string, target: string, doc: DocumentRecord, side?: BilingualSide) {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreview({ kind: "loading", target, doc, side });
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(path)}`)
      .then((nextPage) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "ready", target, doc, page: nextPage, side });
        }
      })
      .catch((nextError: unknown) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "error", target, error: nextError });
        }
      });
  }

  function previewDoc(
    doc: DocumentRecord,
    target: string = doc.title || doc.path,
    side?: BilingualSide,
  ) {
    previewByPath(doc.path, target, doc, side);
  }

  // `side` is the column the link was clicked in (bilingual mode). A click in
  // the translated column carries side="tr", which makes the preview card show
  // the target's Chinese title + summary (AI badge); everything else previews
  // the original page.
  function openWikiLink(target: string, side?: BilingualSide) {
    const match = findPageForTarget(target, basePages);
    if (!match) {
      setPreview({ kind: "not-found", target });
      return;
    }
    previewDoc(match, target, side);
  }

  function openBacklink(path: string) {
    const doc = basePages.find((entry) => entry.path === path);
    if (doc) {
      previewDoc(doc);
      return;
    }
    // pages.data hasn't caught up with this K-page yet (the cache-lag case
    // resolveDerivedPages renders with the wire title). Look up the
    // already-rendered reference for a usable title + layer, then preview
    // by path — the body still comes from GET /v1/base/pages/<path> so
    // pages.data being stale doesn't block the click.
    const ref = sourceReferences.find((entry) => entry.path === path);
    if (!ref) {
      return;
    }
    const stub: DocumentRecord = {
      doc_id: "",
      path: ref.path,
      path_key: ref.path.toLowerCase(),
      title: ref.title,
      hash: "",
      mtime: 0,
      layer: ref.layer,
      active: true,
    };
    previewByPath(ref.path, ref.title, stub);
  }

  function filterByPreviewTarget(target: string) {
    setFilter(target);
  }

  // Directory-column resize: a pointer drag on the gap splitter (with pointer
  // capture so it tracks past the handle) updates the width live; arrow keys
  // step it for keyboard users. Width is clamped and persisted via the effect.
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    sidebarDragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSidebar(true);
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sidebarDragRef.current;
    if (!drag) return;
    setSidebarWidth(clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX)));
  }

  function endSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!sidebarDragRef.current) return;
    sidebarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingSidebar(false);
  }

  function handleSidebarResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth((width) => clampSidebarWidth(width - WIKI_SIDEBAR_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth((width) => clampSidebarWidth(width + WIKI_SIDEBAR_STEP));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSidebarWidth(WIKI_SIDEBAR_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setSidebarWidth(WIKI_SIDEBAR_MAX_WIDTH);
    }
  }

  function clearReader() {
    didAutoSelectRef.current = true;
    previewRequestIdRef.current += 1;
    setSelectedPath(null);
    setPage(null);
    setPageError(null);
    setPageLoading(false);
    setPreview({ kind: "idle" });
  }

  const selectedDoc = basePages.find((doc) => doc.path === page?.path) ?? null;
  const sourceReferences = useMemo<SourceReference[]>(() => {
    // Only trust each response whose `path` matches the page on screen now;
    // a source→source switch updates `page` before the in-flight /links or
    // /provenance call settles.
    const linked =
      backlinks && backlinks.path === page?.path
        ? resolveBacklinks(backlinks.incoming, basePages)
        : [];
    const sourced =
      derived && derived.path === page?.path
        ? resolveDerivedPages(derived.derived_pages, basePages)
        : [];
    // Base exposes only source + knowledge. resolveDerivedPages emits a
    // cache-lag fallback for any provenance path not in basePages (inferring
    // `wisdom` for `wisdom/...`), so drop wisdom refs here too — otherwise a
    // source page's wisdom provenance would still surface/preview from #base.
    return mergeSourceReferences(linked, sourced).filter((ref) => ref.layer !== "wisdom");
  }, [backlinks, derived, page?.path, basePages]);

  // Source 层 read tab 在 body 中首次出现的 K 页 title 上注入合成 wikilink。
  // 非 source 层不动 body;empty refs 时直接退化为原 body + 空 matched set。
  // 只内联已经在 pages.data 里的 ref —— 否则合成的 wikilink 经
  // findPageForTarget → 空,inline-wikilink 按钮会变 dead link;cache-lag 的
  // ref 留在底部 panel,由 openBacklink 的 path-based fallback 兜底。
  const enhancedSourceBody = useMemo(() => {
    if (!page || page.layer !== "source") {
      return { body: page?.body ?? "", matchedPaths: new Set<string>() };
    }
    const knownPaths = new Set(basePages.map((p) => p.path));
    const eligibleRefs = sourceReferences.filter((ref) => knownPaths.has(ref.path));
    return injectInlineRefs(page.body, eligibleRefs);
  }, [page, sourceReferences, basePages]);

  const unlinkedReferences = useMemo<SourceReference[]>(
    () => sourceReferences.filter((ref) => !enhancedSourceBody.matchedPaths.has(ref.path)),
    [sourceReferences, enhancedSourceBody.matchedPaths],
  );

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <IconButton label={copy.refresh} onClick={refreshWiki}>
          <RefreshCw size={18} />
        </IconButton>
      </header>

      {pages.error ? <Notice title={copy.listErrorTitle} error={pages.error} /> : null}

      <section
        className={`wiki-layout ${preview.kind !== "idle" ? "wiki-layout--preview-open" : ""}`}
        style={{ "--wiki-sidebar-w": `${sidebarWidth}px` } as CSSProperties}
      >
        <aside className="wiki-sidebar">
          <div className="wiki-explorer__header">
            <div>
              <h2>{copy.directoryTitle}</h2>
            </div>
            <SoftLabel>{formatFileCount(basePages.length)}</SoftLabel>
          </div>
          <label className="wiki-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
            {filter ? (
              <button
                className="wiki-search__clear"
                type="button"
                onClick={() => setFilter("")}
                aria-label={copy.clearSearch}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <WikiTree
            nodes={tree}
            selectedPath={selectedPath}
            expandedIds={expandedTreeIds}
            onToggle={toggleDirectory}
            onSelect={selectPage}
          />
          {!visiblePages.length ? <EmptyState title={copy.noMatches} /> : null}
        </aside>

        <div
          className="wiki-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={copy.resizeDirectory}
          aria-valuenow={sidebarWidth}
          aria-valuemin={WIKI_SIDEBAR_MIN_WIDTH}
          aria-valuemax={WIKI_SIDEBAR_MAX_WIDTH}
          data-dragging={resizingSidebar ? "true" : "false"}
          tabIndex={0}
          onPointerDown={startSidebarResize}
          onPointerMove={moveSidebarResize}
          onPointerUp={endSidebarResize}
          onPointerCancel={endSidebarResize}
          onKeyDown={handleSidebarResizeKey}
        />

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
          translatorEnabled={translatorEnabled}
          translateCache={translateCache}
        />

        {preview.kind !== "idle" ? (
          <WikiLinkPreview
            preview={preview}
            onClose={() => setPreview({ kind: "idle" })}
            onOpen={selectPage}
            onFilter={filterByPreviewTarget}
            copy={copy}
            translateCache={translateCache}
          />
        ) : null}
      </section>
    </div>
  );
}

function WikiTree({
  nodes,
  selectedPath,
  expandedIds,
  onToggle,
  onSelect,
}: {
  nodes: WikiTreeNode[];
  selectedPath: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="wiki-tree" role="tree" aria-label="Base directory">
      {nodes.map((node) => (
        <WikiTreeNodeView
          key={node.id}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function WikiTreeNodeView({
  node,
  depth,
  selectedPath,
  expandedIds,
  onToggle,
  onSelect,
}: {
  node: WikiTreeNode;
  depth: number;
  selectedPath: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}) {
  if (node.doc) {
    return (
      <div
        role="treeitem"
        aria-label={displayFileName(node.doc)}
        aria-selected={selectedPath === node.doc.path}
      >
        <button
          className={`wiki-tree__item wiki-tree__item--file ${selectedPath === node.doc.path ? "is-selected" : ""}`}
          type="button"
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => onSelect(node.doc?.path ?? "")}
        >
          <FileText size={15} aria-hidden="true" />
          <span>
            <strong>{node.doc.title || basename(node.doc.path)}</strong>
            <small>{truncateMiddle(node.doc.path, 48)}</small>
          </span>
        </button>
      </div>
    );
  }

  const expanded = expandedIds.has(node.id);
  const FolderIcon = expanded ? FolderOpen : Folder;
  const isRoot = node.id === "base";
  return (
    <div role="treeitem" aria-label={node.name} aria-expanded={expanded}>
      <button
        className={`wiki-tree__item wiki-tree__item--folder ${isRoot ? "wiki-tree__item--root" : ""}`}
        type="button"
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        onClick={() => onToggle(node.id)}
      >
        {expanded ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} aria-hidden="true" />
        )}
        <FolderIcon size={15} aria-hidden="true" />
        <strong>{node.name}</strong>
      </button>
      {expanded ? (
        <div role="group">
          {node.children.map((child) => (
            <WikiTreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  enhancedBody,
  translatorEnabled,
  translateCache,
}: {
  page: PageReadResult | null;
  doc: DocumentRecord | null;
  loading: boolean;
  error: unknown;
  onWikiLink: (target: string, side?: BilingualSide) => void;
  references: SourceReference[];
  onOpenBacklink: (path: string) => void;
  copy: WikiCopy;
  assetBaseUrl: string;
  assetToken: string;
  enhancedBody?: string;
  translatorEnabled: boolean;
  translateCache: TranslateCache | null;
}) {
  const [activeTab, setActiveTab] = useState<WikiReaderTab>("read");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const parsed = useMemo(
    () => (page ? parseMarkdownDocument(page.body, { stripDuplicateTitle: false }) : null),
    [page],
  );
  const headings = useMemo(() => (parsed ? extractHeadingsWithSlugs(parsed.body) : []), [parsed]);
  const wikilinks = useMemo(() => (parsed ? extractWikiLinkTargets(parsed.body) : []), [parsed]);

  // Bilingual reading runs over the same content the mono view renders
  // (enhanced source body when present), frontmatter-stripped to match. The
  // EN→中 toggle only appears for English pages when the sidecar translator
  // is configured; language is detected after fetch via CJK ratio.
  const readBody = enhancedBody ?? page?.body ?? "";
  const readerBody = useMemo(
    () => parseMarkdownDocument(readBody, { stripDuplicateTitle: false }).body,
    [readBody],
  );
  const isEnglish = useMemo(() => isEnglishBody(readerBody), [readerBody]);
  const bilingual = useBilingualReader({
    body: readerBody,
    enabled: translatorEnabled,
    cache: translateCache,
  });
  const showBilingualToggle = translatorEnabled && isEnglish;
  const showBilingual = showBilingualToggle && bilingual.active;
  const bilingualToggle = bilingual.toggle;
  const handleToggleBilingual = useCallback(() => {
    setActiveTab("read");
    bilingualToggle();
  }, [bilingualToggle]);

  useEffect(() => {
    setActiveTab("read");
  }, [page?.path]);

  useEffect(() => {
    setShowBackToTop(false);
  }, [page?.path]);

  // The reader currently scrolls the window (`.wiki-reader` is overflow:hidden).
  // If the reader ever switches to its own scroll container, this listener and
  // the scroll targets below need to switch to that element.
  useEffect(() => {
    if (activeTab !== "read") {
      setShowBackToTop(false);
      return;
    }
    const onScroll = () => setShowBackToTop(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [activeTab, page?.path]);

  const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleJumpToHeading = useCallback((slug: string) => {
    setActiveTab("read");
    requestAnimationFrame(() => {
      const el = document.getElementById(slug);
      if (!el) {
        return;
      }
      el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  }, []);

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  return (
    <main className="wiki-reader panel" aria-label="Wiki reader">
      {loading ? <EmptyState title={copy.loadingPage} /> : null}
      {error ? <Notice title={copy.pageErrorTitle} error={error} /> : null}
      {page ? (
        <>
          <div className="reader-header reader-header--stacked">
            <div className="reader-header__path">{page.path}</div>
            <div className="reader-header__meta reader-header__meta--inline">
              <SoftLabel>{formatUnixSeconds(doc?.mtime)}</SoftLabel>
              <SoftLabel>
                {page.layer} · {formatAnchorCount(page.anchors.length)}
              </SoftLabel>
            </div>
          </div>
          <WikiReaderTabs
            activeTab={activeTab}
            onSelect={setActiveTab}
            copy={copy}
            showBilingualToggle={showBilingualToggle}
            bilingualActive={bilingual.active}
            onToggleBilingual={handleToggleBilingual}
          />
          {activeTab === "read" ? (
            <section className="wiki-reader-tab-panel" role="tabpanel" aria-label={copy.readTab}>
              {showBilingual ? (
                <>
                  <BilingualStatusBar reader={bilingual} copy={copy} />
                  <BilingualView
                    blocks={bilingual.blocks}
                    ctx={{ assets: page.assets, assetBaseUrl, assetToken }}
                    translating={bilingual.translating}
                    onWikiLink={onWikiLink}
                    sourceColHead={copy.bilingual.sourceColHead}
                    trColHead={copy.bilingual.trColHead}
                  />
                </>
              ) : (
                <MarkdownView
                  body={enhancedBody ?? page.body}
                  fallbackTitle={page.title || getMarkdownTitle(page.body) || basename(page.path)}
                  onWikiLink={onWikiLink}
                  showFrontmatter={false}
                  assets={page.assets}
                  assetBaseUrl={assetBaseUrl}
                  assetToken={assetToken}
                />
              )}
              {references.length > 0 ? (
                <WikiBacklinksSection
                  references={references}
                  onOpenBacklink={onOpenBacklink}
                  copy={copy}
                />
              ) : null}
            </section>
          ) : null}
          {activeTab === "info" ? <WikiInfoPanel page={page} doc={doc} copy={copy} /> : null}
          {activeTab === "outline" ? (
            <WikiOutlinePanel
              headings={headings}
              wikilinks={wikilinks}
              anchors={page.anchors.length}
              onWikiLink={onWikiLink}
              onJumpToHeading={handleJumpToHeading}
              copy={copy}
            />
          ) : null}
          {activeTab === "source" ? (
            <section className="wiki-reader-tab-panel" role="tabpanel" aria-label={copy.sourceTab}>
              <pre className="wiki-source-code">{page.body}</pre>
            </section>
          ) : null}
          {showBackToTop && activeTab === "read" ? (
            <button
              type="button"
              className="reader-back-to-top"
              aria-label={copy.backToTop}
              title={copy.backToTop}
              onClick={handleBackToTop}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          ) : null}
        </>
      ) : !loading && !error ? (
        <EmptyState title={copy.emptyReader} />
      ) : null}
    </main>
  );
}

function WikiReaderTabs({
  activeTab,
  onSelect,
  copy,
  showBilingualToggle,
  bilingualActive,
  onToggleBilingual,
}: {
  activeTab: WikiReaderTab;
  onSelect: (tab: WikiReaderTab) => void;
  copy: WikiCopy;
  showBilingualToggle: boolean;
  bilingualActive: boolean;
  onToggleBilingual: () => void;
}) {
  // The Read tab is fused with the AI-translate toggle (one pill, two bonded
  // halves). Info / Outline / Source stay plain sibling tabs.
  const siblingTabs: Array<{ id: WikiReaderTab; label: string }> = [
    { id: "info", label: copy.infoTab },
    { id: "outline", label: copy.outlineTab },
    { id: "source", label: copy.sourceTab },
  ];
  return (
    <div className="wiki-reader-tabs" role="tablist" aria-label={copy.tabList}>
      <span className={`wrt-fused ${activeTab === "read" ? "is-active" : ""}`}>
        <button
          type="button"
          role="tab"
          className="wrt-read"
          aria-selected={activeTab === "read"}
          onClick={() => onSelect("read")}
        >
          {copy.readTab}
        </button>
        {showBilingualToggle ? (
          <button
            type="button"
            role="switch"
            className="wrt-bi"
            aria-checked={bilingualActive}
            aria-label={copy.bilingual.toggleAria}
            title={copy.bilingual.toggleAria}
            onClick={onToggleBilingual}
          >
            <span className="wrt-bi__label">{copy.bilingual.toggle}</span>
            <span className="wrt-switch" aria-hidden="true">
              <span className="wrt-switch__thumb" />
            </span>
          </button>
        ) : null}
      </span>
      {siblingTabs.map((tab) => (
        <button
          className={activeTab === tab.id ? "is-active" : ""}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function BilingualStatusBar({ reader, copy }: { reader: BilingualReader; copy: WikiCopy }) {
  const bi = copy.bilingual;
  if (reader.error) {
    return (
      <div className="bi-statusbar bi-statusbar--error" role="status" aria-live="polite">
        <span className="bi-statusbar__left">{bi.errorTitle}</span>
        <button type="button" className="bi-statusbar__action" onClick={reader.retranslate}>
          {bi.retranslate}
        </button>
      </div>
    );
  }
  if (reader.translating) {
    return (
      <div className="bi-statusbar" role="status" aria-live="polite">
        <span className="bi-statusbar__left">
          <span className="bi-spinner" aria-hidden="true" />
          {bi.translating}
        </span>
        <button type="button" className="bi-statusbar__action" onClick={reader.cancel}>
          {bi.cancel}
        </button>
      </div>
    );
  }
  return (
    <div className="bi-statusbar" role="status" aria-live="polite">
      <span className="bi-statusbar__left">
        {bi.toggle}
        {reader.cached ? <span className="bi-chip">{bi.cached}</span> : null}
      </span>
      <button type="button" className="bi-statusbar__action" onClick={reader.retranslate}>
        {bi.retranslate}
      </button>
    </div>
  );
}

function WikiInfoPanel({
  page,
  doc,
  copy,
}: {
  page: PageReadResult;
  doc: DocumentRecord | null;
  copy: WikiCopy;
}) {
  // Surface the server-parsed frontmatter (PageReadResult.frontmatter, 0.4.0+)
  // read-only. tags/sources get a dedicated chip treatment below, so they are
  // kept out of the key/value grid to avoid duplicate rows.
  const frontmatter = page.frontmatter ?? {};
  const tags = asStringList(frontmatter.tags);
  const sources = asStringList(frontmatter.sources);
  // Fixed rows below already show path/layer/anchors/updated, and tags/sources
  // render as chips — exclude those keys (and empty values) so the grid never
  // shows a duplicate or blank row.
  const reservedKeys = new Set(["path", "layer", "anchors", "updated", "tags", "sources"]);
  const frontmatterRows = Object.entries(frontmatter)
    .filter(([key]) => !reservedKeys.has(key))
    .map(([key, value]) => [key, stringifyFrontmatterValue(value)] as const)
    .filter(([, value]) => value !== "");
  return (
    <section
      className="wiki-reader-tab-panel wiki-info-panel"
      role="tabpanel"
      aria-label={copy.infoPanel}
    >
      <dl className="wiki-info-grid">
        <div>
          <dt>path</dt>
          <dd>{page.path}</dd>
        </div>
        <div>
          <dt>layer</dt>
          <dd>{page.layer}</dd>
        </div>
        <div>
          <dt>anchors</dt>
          <dd>{formatAnchorCount(page.anchors.length)}</dd>
        </div>
        <div>
          <dt>updated</dt>
          <dd>{formatUnixSeconds(doc?.mtime)}</dd>
        </div>
        {frontmatterRows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {tags.length || sources.length ? (
        <div className="wiki-info-chips" aria-label="Frontmatter chips">
          {tags.map((tag) => (
            <FrontmatterChip variant="tag" key={`tag-${tag}`}>
              #{tag}
            </FrontmatterChip>
          ))}
          {sources.map((source) => (
            <FrontmatterChip variant="source" key={`source-${source}`}>
              {source}
            </FrontmatterChip>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WikiOutlinePanel({
  headings,
  wikilinks,
  anchors,
  onWikiLink,
  onJumpToHeading,
  copy,
}: {
  headings: HeadingEntry[];
  wikilinks: string[];
  anchors: number;
  onWikiLink: (target: string) => void;
  onJumpToHeading: (slug: string) => void;
  copy: WikiCopy;
}) {
  return (
    <section
      className="wiki-reader-tab-panel wiki-outline-panel"
      role="tabpanel"
      aria-label={copy.outlinePanel}
    >
      <div className="wiki-outline-summary">
        <SoftLabel>{headings.length} headings</SoftLabel>
        <SoftLabel>{wikilinks.length} wikilinks</SoftLabel>
        <SoftLabel>{formatAnchorCount(anchors)}</SoftLabel>
      </div>
      <div className="wiki-outline-columns">
        <section>
          <h2>Headings</h2>
          {headings.length ? (
            <>
              <p className="wiki-outline-hint soft-label">{copy.outlineJumpHint}</p>
              <ol className="wiki-outline-list">
                {headings.map((heading, index) => (
                  <li
                    key={`${heading.slug}-${index}`}
                    style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10}px` }}
                  >
                    <button
                      type="button"
                      className="wiki-outline-jump"
                      onClick={() => onJumpToHeading(heading.slug)}
                    >
                      {heading.title}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <EmptyState title={copy.noHeadings} />
          )}
        </section>
        <section>
          <h2>Wikilinks</h2>
          {wikilinks.length ? (
            <div className="wiki-outline-links">
              {wikilinks.map((target) => (
                <button
                  className="inline-wikilink"
                  type="button"
                  key={target}
                  onClick={() => onWikiLink(target)}
                >
                  {target}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={copy.noWikilinks} />
          )}
        </section>
      </div>
    </section>
  );
}

function WikiBacklinksSection({
  references,
  onOpenBacklink,
  copy,
}: {
  references: SourceReference[];
  onOpenBacklink: (path: string) => void;
  copy: WikiCopy;
}) {
  return (
    <section className="wiki-backlinks" aria-label={copy.linkedRefsTitle}>
      <h2 className="wiki-backlinks__title">{copy.linkedRefsTitle}</h2>
      <ul className="wiki-backlinks__list">
        {references.map((ref) => (
          <li className="wiki-backlinks__item" key={ref.path}>
            <button
              type="button"
              className="inline-wikilink"
              onClick={() => onOpenBacklink(ref.path)}
            >
              {ref.title}
            </button>
            <SoftLabel className="wiki-backlinks__layer">{ref.layer}</SoftLabel>
            {ref.sources.includes("linked") ? (
              <SoftLabel
                className="wiki-backlinks__source wiki-backlinks__source--linked"
                aria-label={copy.referenceSourceLinkedAria}
              >
                {copy.referenceSourceLinked}
              </SoftLabel>
            ) : null}
            {ref.sources.includes("sourced") ? (
              <SoftLabel
                className="wiki-backlinks__source wiki-backlinks__source--sourced"
                aria-label={copy.referenceSourceSourcedAria}
              >
                {copy.referenceSourceSourced}
              </SoftLabel>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WikiLinkPreview({
  preview,
  onClose,
  onOpen,
  onFilter,
  copy,
  translateCache,
}: {
  preview: PreviewState;
  onClose: () => void;
  onOpen: (path: string) => void;
  onFilter: (target: string) => void;
  copy: WikiCopy;
  translateCache: TranslateCache | null;
}) {
  return (
    <aside
      className="wiki-preview panel wiki-preview--open"
      role="region"
      aria-label={copy.previewRegion}
    >
      {preview.kind === "loading" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <EmptyState title={copy.previewLoading} detail={preview.target} />
        </PreviewFrame>
      ) : null}
      {preview.kind === "ready" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <WikiPreviewCard
            page={preview.page}
            doc={preview.doc}
            side={preview.side}
            translateCache={translateCache}
            copy={copy}
            onOpen={onOpen}
          />
        </PreviewFrame>
      ) : null}
      {preview.kind === "not-found" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <div className="wiki-preview-card wiki-preview-card--empty">
            <h2>{copy.previewNotFound}</h2>
            <p>{preview.target}</p>
            <Button variant="secondary" onClick={() => onFilter(preview.target)}>
              {copy.previewFilter}
            </Button>
          </div>
        </PreviewFrame>
      ) : null}
      {preview.kind === "error" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <Notice title={copy.previewErrorTitle} error={preview.error} />
        </PreviewFrame>
      ) : null}
    </aside>
  );
}

function WikiPreviewCard({
  page,
  doc,
  side,
  translateCache,
  copy,
  onOpen,
}: {
  page: PageReadResult;
  doc: DocumentRecord;
  side?: BilingualSide;
  translateCache: TranslateCache | null;
  copy: WikiCopy;
  onOpen: (path: string) => void;
}) {
  const title = page.title || getMarkdownTitle(page.body) || basename(page.path);
  const summary = summarizeMarkdown(page.body);
  // Translate the card only for a translated-column click on an English target —
  // a src-side / mono click, or an already-Chinese page, renders as-is. The
  // original text shows until the translation lands (the shared IndexedDB cache
  // makes a revisited card instant).
  const tr = usePreviewTranslation({
    enabled: side === "tr" && isEnglishBody(`${title}\n${summary}`),
    title,
    summary,
    cache: translateCache,
  });
  return (
    <article className="wiki-preview-card">
      <div className="reader-header__path">{page.path}</div>
      <h2>{tr.title || title}</h2>
      <div className="wiki-preview-card__meta">
        <SoftLabel>{page.layer}</SoftLabel>
        <SoftLabel>{formatAnchorCount(page.anchors.length)}</SoftLabel>
        {tr.translated ? (
          <SoftLabel className="wiki-preview-card__ai">{copy.bilingual.aiBadge}</SoftLabel>
        ) : null}
      </div>
      <p>{tr.summary || summary}</p>
      {/* Hide "Open as main document" for cache-lag stub docs (doc_id === "") —
          the selection effect would round-trip the unknown path back to the
          default page since visiblePages doesn't contain it yet. */}
      {doc.doc_id ? (
        <Button variant="secondary" onClick={() => onOpen(page.path)}>
          {copy.previewOpen}
        </Button>
      ) : null}
    </article>
  );
}

function PreviewFrame({
  title,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="wiki-preview__header">
        <span>{title}</span>
        <IconButton label={closeLabel} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      {children}
    </>
  );
}

function buildWikiTree(docs: DocumentRecord[]): WikiTreeNode[] {
  const root: WikiTreeNode = { id: "base", name: "base", children: [], doc: null };
  for (const doc of docs) {
    const parts = doc.path.split("/").filter(Boolean);
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const id = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      let child = current.children.find((node) => node.id === id);
      if (!child) {
        child = {
          id,
          name: isFile ? displayFileName(doc) : part,
          children: [],
          doc: isFile ? doc : null,
        };
        current.children.push(child);
      }
      if (isFile) {
        child.doc = doc;
        child.name = displayFileName(doc);
      }
      current = child;
    }
  }
  sortTree(root);
  return [root];
}

function sortTree(node: WikiTreeNode) {
  node.children.sort((a, b) => {
    if (Boolean(a.doc) !== Boolean(b.doc)) {
      return a.doc ? 1 : -1;
    }
    const rankDelta = treeNodeRank(node, a) - treeNodeRank(node, b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

function treeNodeRank(parent: WikiTreeNode, node: WikiTreeNode): number {
  if (parent.id !== "base" || node.doc) {
    return 10;
  }
  if (node.name === "knowledge") {
    return 0;
  }
  if (node.name === "sources" || node.name === "source") {
    return 1;
  }
  return 10;
}

function pickDefaultPagePath(docs: DocumentRecord[]): string | null {
  return (
    (
      docs.find((doc) => doc.layer === "knowledge" || doc.path.startsWith("knowledge/")) ??
      docs[0] ??
      null
    )?.path ?? null
  );
}

function collectDirectoryIds(nodes: WikiTreeNode[], target: Set<string>) {
  for (const node of nodes) {
    if (!node.doc) {
      target.add(node.id);
      collectDirectoryIds(node.children, target);
    }
  }
}

function collectPathAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return ["base", ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))];
}

function pathIsInsideDirectory(path: string, directoryId: string): boolean {
  return directoryId === "base" || path === directoryId || path.startsWith(`${directoryId}/`);
}

function summarizeMarkdown(body: string): string {
  const parsed = parseMarkdownDocument(body, { stripDuplicateTitle: false });
  const text = parsed.body
    .replace(/^# .+$/m, "")
    .replace(
      /\[\[([^\]|]+)\|?([^\]]+)?\]\]/g,
      (_match, target: string, label?: string) => label ?? target,
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? truncateMiddle(text, 220) : "没有可预览的正文。";
}

function extractWikiLinkTargets(body: string): string[] {
  const targets = new Set<string>();
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    targets.add(match[1].trim());
  }
  return Array.from(targets);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function stringifyFrontmatterValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function displayFileName(doc: DocumentRecord): string {
  return displayTitle(doc);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatAnchorCount(count: number): string {
  return `${count} ${count === 1 ? "anchor" : "anchors"}`;
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}
