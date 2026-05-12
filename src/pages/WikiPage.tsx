import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { Notice } from "../components/Notice";
import { useAsyncResource } from "../hooks/useAsyncResource";
import type { DocumentRecord, PageReadResult } from "../types";
import { findPageForTarget } from "../utils/graph";
import { getMarkdownTitle, parseMarkdownDocument } from "../utils/markdown";
import { formatUnixSeconds, truncateMiddle } from "../utils/format";

interface WikiPageProps {
  client: DikwClient;
  initialPath?: string | null;
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

export function WikiPage({ client, initialPath }: WikiPageProps) {
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [page, setPage] = useState<PageReadResult | null>(null);
  const [pageError, setPageError] = useState<unknown>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageReloadId, setPageReloadId] = useState(0);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
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

  const visiblePages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const docs = pages.data ?? [];
    if (!needle) {
      return docs;
    }
    return docs.filter((doc) => {
      const haystack = `${doc.path} ${doc.title ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, pages.data]);

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
  }, [selectedPath, visiblePages]);

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

  function openWikiLink(target: string) {
    const match = findPageForTarget(target, pages.data ?? []);
    if (!match) {
      setPreview({ kind: "not-found", target });
      return;
    }

    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreview({ kind: "loading", target, doc: match });
    client
      .get<PageReadResult>(`/v1/base/pages/${encodePath(match.path)}`)
      .then((nextPage) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "ready", target, doc: match, page: nextPage });
        }
      })
      .catch((nextError: unknown) => {
        if (previewRequestIdRef.current === requestId) {
          setPreview({ kind: "error", target, error: nextError });
        }
      });
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

  const selectedDoc = pages.data?.find((doc) => doc.path === page?.path) ?? null;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Wiki</p>
          <h1>知识库</h1>
        </div>
        <button className="icon-button" type="button" onClick={refreshWiki} aria-label="刷新知识库">
          <RefreshCw size={18} />
        </button>
      </header>

      {pages.error ? <Notice title="无法读取 wiki pages" error={pages.error} /> : null}

      <section className={`wiki-layout ${preview.kind !== "idle" ? "wiki-layout--preview-open" : ""}`}>
        <aside className="wiki-sidebar">
          <div className="wiki-explorer__header">
            <div>
              <p className="eyebrow">Base</p>
              <h2>目录 / Directory</h2>
            </div>
            <span className="soft-label">{formatFileCount(pages.data?.length ?? 0)}</span>
          </div>
          <label className="wiki-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索文件 / Search files..."
            />
            {filter ? (
              <button className="wiki-search__clear" type="button" onClick={() => setFilter("")} aria-label="清空目录搜索">
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
          {!visiblePages.length ? <EmptyState title="没有匹配页面" /> : null}
        </aside>

        <WikiReader
          page={page}
          doc={selectedDoc}
          loading={pageLoading}
          error={pageError}
          onWikiLink={openWikiLink}
        />

        {preview.kind !== "idle" ? (
          <WikiLinkPreview
            preview={preview}
            onClose={() => setPreview({ kind: "idle" })}
            onOpen={selectPage}
            onFilter={filterByPreviewTarget}
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
  onWikiLink
}: {
  page: PageReadResult | null;
  doc: DocumentRecord | null;
  loading: boolean;
  error: unknown;
  onWikiLink: (target: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<WikiReaderTab>("read");
  const parsed = useMemo(
    () => (page ? parseMarkdownDocument(page.body, { stripDuplicateTitle: false }) : null),
    [page]
  );
  const headings = useMemo(() => (parsed ? extractHeadings(parsed.body) : []), [parsed]);
  const wikilinks = useMemo(() => (parsed ? extractWikiLinkTargets(parsed.body) : []), [parsed]);

  useEffect(() => {
    setActiveTab("read");
  }, [page?.path]);

  return (
    <main className="wiki-reader panel" aria-label="Wiki reader">
      {loading ? <EmptyState title="读取页面中" /> : null}
      {error ? <Notice title="无法读取页面" error={error} /> : null}
      {page ? (
        <>
          <div className="reader-header reader-header--metadata-only">
            <div className="reader-header__path">{page.path}</div>
            <div className="reader-header__meta">
              <span className="soft-label">{page.layer} · {formatAnchorCount(page.anchors.length)}</span>
              <span className="soft-label">{formatUnixSeconds(doc?.mtime)}</span>
            </div>
          </div>
          <WikiReaderTabs activeTab={activeTab} onSelect={setActiveTab} />
          {activeTab === "read" ? (
            <section className="wiki-reader-tab-panel" role="tabpanel" aria-label="阅读 / Read">
              <MarkdownView
                body={page.body}
                fallbackTitle={page.title || getMarkdownTitle(page.body) || basename(page.path)}
                onWikiLink={onWikiLink}
                showFrontmatter={false}
              />
            </section>
          ) : null}
          {activeTab === "info" && parsed ? (
            <WikiInfoPanel page={page} doc={doc} meta={parsed.meta} />
          ) : null}
          {activeTab === "outline" ? (
            <WikiOutlinePanel headings={headings} wikilinks={wikilinks} anchors={page.anchors.length} onWikiLink={onWikiLink} />
          ) : null}
          {activeTab === "source" ? (
            <section className="wiki-reader-tab-panel" role="tabpanel" aria-label="源码 / Source">
              <pre className="wiki-source-code">{page.body}</pre>
            </section>
          ) : null}
        </>
      ) : !loading && !error ? (
        <EmptyState title="选择一篇文档开始阅读" />
      ) : null}
    </main>
  );
}

function WikiReaderTabs({ activeTab, onSelect }: { activeTab: WikiReaderTab; onSelect: (tab: WikiReaderTab) => void }) {
  const tabs: Array<{ id: WikiReaderTab; label: string }> = [
    { id: "read", label: "阅读 / Read" },
    { id: "info", label: "信息 / Info" },
    { id: "outline", label: "目录与链接 / Outline" },
    { id: "source", label: "源码 / Source" }
  ];
  return (
    <div className="wiki-reader-tabs" role="tablist" aria-label="Wiki reader views">
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
  meta
}: {
  page: PageReadResult;
  doc: DocumentRecord | null;
  meta: Record<string, string | string[] | undefined>;
}) {
  const metaRows = Object.entries(meta).filter(([, value]) => typeof value === "string" && value.length > 0) as Array<[string, string]>;
  const tags = asStringList(meta.tags);
  const sources = asStringList(meta.sources);
  return (
    <section className="wiki-reader-tab-panel wiki-info-panel" role="tabpanel" aria-label="信息 / Info">
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
        {metaRows.map(([key, value]) => (
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
  onWikiLink
}: {
  headings: Array<{ level: number; title: string }>;
  wikilinks: string[];
  anchors: number;
  onWikiLink: (target: string) => void;
}) {
  return (
    <section className="wiki-reader-tab-panel wiki-outline-panel" role="tabpanel" aria-label="目录与链接 / Outline">
      <div className="wiki-outline-summary">
        <span className="soft-label">{headings.length} headings</span>
        <span className="soft-label">{wikilinks.length} wikilinks</span>
        <span className="soft-label">{formatAnchorCount(anchors)}</span>
      </div>
      <div className="wiki-outline-columns">
        <section>
          <h2>Headings</h2>
          {headings.length ? (
            <ol className="wiki-outline-list">
              {headings.map((heading, index) => (
                <li key={`${heading.title}-${index}`} style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10}px` }}>
                  <h3>{heading.title}</h3>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="没有目录" />
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
            <EmptyState title="没有 wikilink" />
          )}
        </section>
      </div>
    </section>
  );
}

function WikiLinkPreview({
  preview,
  onClose,
  onOpen,
  onFilter
}: {
  preview: PreviewState;
  onClose: () => void;
  onOpen: (path: string) => void;
  onFilter: (target: string) => void;
}) {
  return (
    <aside className="wiki-preview panel wiki-preview--open" role="region" aria-label="Wiki link preview">
      {preview.kind === "loading" ? (
        <PreviewFrame title="Link preview" onClose={onClose}>
          <EmptyState title="读取引用页面中" detail={preview.target} />
        </PreviewFrame>
      ) : null}
      {preview.kind === "ready" ? (
        <PreviewFrame title="Link preview" onClose={onClose}>
          <article className="wiki-preview-card">
            <div className="reader-header__path">{preview.page.path}</div>
            <h2>{preview.page.title || getMarkdownTitle(preview.page.body) || basename(preview.page.path)}</h2>
            <div className="wiki-preview-card__meta">
              <span className="soft-label">{preview.page.layer}</span>
              <span className="soft-label">{formatAnchorCount(preview.page.anchors.length)}</span>
            </div>
            <p>{summarizeMarkdown(preview.page.body)}</p>
            <button className="secondary-button" type="button" onClick={() => onOpen(preview.page.path)}>
              打开为主文档
            </button>
          </article>
        </PreviewFrame>
      ) : null}
      {preview.kind === "not-found" ? (
        <PreviewFrame title="Link preview" onClose={onClose}>
          <div className="wiki-preview-card wiki-preview-card--empty">
            <h2>未找到引用页面</h2>
            <p>{preview.target}</p>
            <button className="secondary-button" type="button" onClick={() => onFilter(preview.target)}>
              用目标过滤目录
            </button>
          </div>
        </PreviewFrame>
      ) : null}
      {preview.kind === "error" ? (
        <PreviewFrame title="Link preview" onClose={onClose}>
          <Notice title="无法读取引用页面" error={preview.error} />
        </PreviewFrame>
      ) : null}
    </aside>
  );
}

function PreviewFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="wiki-preview__header">
        <span>{title}</span>
        <button className="icon-button" type="button" onClick={onClose} aria-label="收起链接预览">
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
  if (node.name === "wiki") {
    return 0;
  }
  if (node.name === "sources" || node.name === "source") {
    return 1;
  }
  return 10;
}

function pickDefaultPagePath(docs: DocumentRecord[]): string | null {
  return (docs.find((doc) => doc.layer === "wiki" || doc.path.startsWith("wiki/")) ?? docs[0] ?? null)?.path ?? null;
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

function extractHeadings(body: string): Array<{ level: number; title: string }> {
  return body
    .split(/\r?\n/)
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ level: match[1].length, title: match[2].trim() }));
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

function asStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function displayFileName(doc: DocumentRecord): string {
  return doc.title || basename(doc.path).replace(/\.md$/i, "");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function formatAnchorCount(count: number): string {
  return `${count} ${count === 1 ? "anchor" : "anchors"}`;
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}
