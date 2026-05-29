import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowUp, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { Notice } from "../components/Notice";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import type { DocumentRecord, PageLinksResult, PageProvenanceResult, PageReadResult } from "../types";
import { findPageForTarget } from "../utils/graph";
import {
  mergeSourceReferences,
  resolveBacklinks,
  resolveDerivedPages,
  type SourceReference
} from "../utils/links";
import { extractHeadingsWithSlugs, getMarkdownTitle, parseMarkdownDocument, type HeadingEntry } from "../utils/markdown";
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
  | { kind: "loading"; target: string; doc: DocumentRecord }
  | { kind: "ready"; target: string; doc: DocumentRecord; page: PageReadResult }
  | { kind: "not-found"; target: string }
  | { kind: "error"; target: string; error: unknown };

type WikiReaderTab = "read" | "info" | "outline" | "source";
type WikiCopy = (typeof translations)["en"]["pages"]["wiki"];

export function WikiPage({ client, initialPath, locale = "en", assetBaseUrl = "", assetToken = "" }: WikiPageProps) {
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

  const loadPages = useCallback(
    (signal: AbortSignal) => client.get<DocumentRecord[]>("/v1/base/pages", { signal, params: { active: true } }),
    [client]
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
    [pages.data]
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
  }, [expandedDirs, filter, selectedPath, tree, visiblePages]);

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
      .get<PageReadResult>(`/v1/base/pages/${encodePath(selectedPath)}`, { signal: controller.signal })
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
        params: { direction: "in" }
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
        params: { direction: "in" }
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
            `[wiki] /provenance for source page ${loadedPath} returned ${result.derived_from.length} derived_from entries; core contract says this should be empty.`
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

  function previewByPath(path: string, target: string, doc: DocumentRecord) {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreview({ kind: "loading", target, doc });
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(path)}`)
      .then((nextPage) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "ready", target, doc, page: nextPage });
        }
      })
      .catch((nextError: unknown) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "error", target, error: nextError });
        }
      });
  }

  function previewDoc(doc: DocumentRecord, target: string = doc.title || doc.path) {
    previewByPath(doc.path, target, doc);
  }

  function openWikiLink(target: string) {
    const match = findPageForTarget(target, basePages);
    if (!match) {
      setPreview({ kind: "not-found", target });
      return;
    }
    previewDoc(match, target);
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
      active: true
    };
    previewByPath(ref.path, ref.title, stub);
  }

  function filterByPreviewTarget(target: string) {
    setFilter(target);
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
      backlinks && backlinks.path === page?.path ? resolveBacklinks(backlinks.incoming, basePages) : [];
    const sourced =
      derived && derived.path === page?.path ? resolveDerivedPages(derived.derived_pages, basePages) : [];
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
    [sourceReferences, enhancedSourceBody.matchedPaths]
  );

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={refreshWiki} aria-label={copy.refresh}>
          <RefreshCw size={18} />
        </button>
      </header>

      {pages.error ? <Notice title={copy.listErrorTitle} error={pages.error} /> : null}

      <section className={`wiki-layout ${preview.kind !== "idle" ? "wiki-layout--preview-open" : ""}`}>
        <aside className="wiki-sidebar">
          <div className="wiki-explorer__header">
            <div>
              <h2>{copy.directoryTitle}</h2>
            </div>
            <span className="soft-label">{formatFileCount(basePages.length)}</span>
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
              <button className="wiki-search__clear" type="button" onClick={() => setFilter("")} aria-label={copy.clearSearch}>
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

        {preview.kind !== "idle" ? (
          <WikiLinkPreview
            preview={preview}
            onClose={() => setPreview({ kind: "idle" })}
            onOpen={selectPage}
            onFilter={filterByPreviewTarget}
            copy={copy}
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
  onSelect
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
  onSelect
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
      <div role="treeitem" aria-label={displayFileName(node.doc)} aria-selected={selectedPath === node.doc.path}>
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
        {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
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
  const [activeTab, setActiveTab] = useState<WikiReaderTab>("read");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const parsed = useMemo(
    () => (page ? parseMarkdownDocument(page.body, { stripDuplicateTitle: false }) : null),
    [page]
  );
  const headings = useMemo(() => (parsed ? extractHeadingsWithSlugs(parsed.body) : []), [parsed]);
  const wikilinks = useMemo(() => (parsed ? extractWikiLinkTargets(parsed.body) : []), [parsed]);

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
              <span className="soft-label">{formatUnixSeconds(doc?.mtime)}</span>
              <span className="soft-label">{page.layer} · {formatAnchorCount(page.anchors.length)}</span>
            </div>
          </div>
          <WikiReaderTabs activeTab={activeTab} onSelect={setActiveTab} copy={copy} />
          {activeTab === "read" ? (
            <section className="wiki-reader-tab-panel" role="tabpanel" aria-label={copy.readTab}>
              <MarkdownView
                body={enhancedBody ?? page.body}
                fallbackTitle={page.title || getMarkdownTitle(page.body) || basename(page.path)}
                onWikiLink={onWikiLink}
                showFrontmatter={false}
                assets={page.assets}
                assetBaseUrl={assetBaseUrl}
                assetToken={assetToken}
              />
              {references.length > 0 ? (
                <WikiBacklinksSection references={references} onOpenBacklink={onOpenBacklink} copy={copy} />
              ) : null}
            </section>
          ) : null}
          {activeTab === "info" ? (
            <WikiInfoPanel page={page} doc={doc} copy={copy} />
          ) : null}
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
  copy
}: {
  activeTab: WikiReaderTab;
  onSelect: (tab: WikiReaderTab) => void;
  copy: WikiCopy;
}) {
  const tabs: Array<{ id: WikiReaderTab; label: string }> = [
    { id: "read", label: copy.readTab },
    { id: "info", label: copy.infoTab },
    { id: "outline", label: copy.outlineTab },
    { id: "source", label: copy.sourceTab }
  ];
  return (
    <div className="wiki-reader-tabs" role="tablist" aria-label={copy.tabList}>
      {tabs.map((tab) => (
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

function WikiInfoPanel({
  page,
  doc,
  copy
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
    <section className="wiki-reader-tab-panel wiki-info-panel" role="tabpanel" aria-label={copy.infoPanel}>
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
            <span className="frontmatter-chip frontmatter-chip--tag" key={`tag-${tag}`}>
              #{tag}
            </span>
          ))}
          {sources.map((source) => (
            <span className="frontmatter-chip frontmatter-chip--source" key={`source-${source}`}>
              {source}
            </span>
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
  copy
}: {
  headings: HeadingEntry[];
  wikilinks: string[];
  anchors: number;
  onWikiLink: (target: string) => void;
  onJumpToHeading: (slug: string) => void;
  copy: WikiCopy;
}) {
  return (
    <section className="wiki-reader-tab-panel wiki-outline-panel" role="tabpanel" aria-label={copy.outlinePanel}>
      <div className="wiki-outline-summary">
        <span className="soft-label">{headings.length} headings</span>
        <span className="soft-label">{wikilinks.length} wikilinks</span>
        <span className="soft-label">{formatAnchorCount(anchors)}</span>
      </div>
      <div className="wiki-outline-columns">
        <section>
          <h2>Headings</h2>
          {headings.length ? (
            <>
              <p className="wiki-outline-hint soft-label">{copy.outlineJumpHint}</p>
              <ol className="wiki-outline-list">
                {headings.map((heading, index) => (
                  <li key={`${heading.slug}-${index}`} style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10}px` }}>
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
                <button className="inline-wikilink" type="button" key={target} onClick={() => onWikiLink(target)}>
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
  copy
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
            <button type="button" className="inline-wikilink" onClick={() => onOpenBacklink(ref.path)}>
              {ref.title}
            </button>
            <span className="soft-label wiki-backlinks__layer">{ref.layer}</span>
            {ref.sources.includes("linked") ? (
              <span
                className="soft-label wiki-backlinks__source wiki-backlinks__source--linked"
                aria-label={copy.referenceSourceLinkedAria}
              >
                {copy.referenceSourceLinked}
              </span>
            ) : null}
            {ref.sources.includes("sourced") ? (
              <span
                className="soft-label wiki-backlinks__source wiki-backlinks__source--sourced"
                aria-label={copy.referenceSourceSourcedAria}
              >
                {copy.referenceSourceSourced}
              </span>
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
  copy
}: {
  preview: PreviewState;
  onClose: () => void;
  onOpen: (path: string) => void;
  onFilter: (target: string) => void;
  copy: WikiCopy;
}) {
  return (
    <aside className="wiki-preview panel wiki-preview--open" role="region" aria-label={copy.previewRegion}>
      {preview.kind === "loading" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <EmptyState title={copy.previewLoading} detail={preview.target} />
        </PreviewFrame>
      ) : null}
      {preview.kind === "ready" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <article className="wiki-preview-card">
            <div className="reader-header__path">{preview.page.path}</div>
            <h2>{preview.page.title || getMarkdownTitle(preview.page.body) || basename(preview.page.path)}</h2>
            <div className="wiki-preview-card__meta">
              <span className="soft-label">{preview.page.layer}</span>
              <span className="soft-label">{formatAnchorCount(preview.page.anchors.length)}</span>
            </div>
            <p>{summarizeMarkdown(preview.page.body)}</p>
            {/* Hide "Open as main document" for cache-lag stub docs (doc_id === "") —
                the selection effect would round-trip the unknown path back to the
                default page since visiblePages doesn't contain it yet. */}
            {preview.doc.doc_id ? (
              <button className="secondary-button" type="button" onClick={() => onOpen(preview.page.path)}>
                {copy.previewOpen}
              </button>
            ) : null}
          </article>
        </PreviewFrame>
      ) : null}
      {preview.kind === "not-found" ? (
        <PreviewFrame title={copy.previewTitle} onClose={onClose} closeLabel={copy.previewClose}>
          <div className="wiki-preview-card wiki-preview-card--empty">
            <h2>{copy.previewNotFound}</h2>
            <p>{preview.target}</p>
            <button className="secondary-button" type="button" onClick={() => onFilter(preview.target)}>
              {copy.previewFilter}
            </button>
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

function PreviewFrame({
  title,
  onClose,
  closeLabel,
  children
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
        <button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}>
          <X size={16} />
        </button>
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
          doc: isFile ? doc : null
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
  return (docs.find((doc) => doc.layer === "knowledge" || doc.path.startsWith("knowledge/")) ?? docs[0] ?? null)?.path ?? null;
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
    .replace(/\[\[([^\]|]+)\|?([^\]]+)?\]\]/g, (_match, target: string, label?: string) => label ?? target)
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
    return value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(", ");
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
