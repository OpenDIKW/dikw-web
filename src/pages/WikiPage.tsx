import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { MarkdownView } from "../components/MarkdownView";
import { Notice } from "../components/Notice";
import { useAsyncResource } from "../hooks/useAsyncResource";
import type { DocumentRecord, WikiPageResponse } from "../types";
import { getMarkdownTitle } from "../utils/markdown";
import { formatUnixSeconds, truncateMiddle } from "../utils/format";

interface WikiPageProps {
  client: DikwClient;
}

export function WikiPage({ client }: WikiPageProps) {
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [page, setPage] = useState<WikiPageResponse | null>(null);
  const [pageError, setPageError] = useState<unknown>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageReloadId, setPageReloadId] = useState(0);

  const loadPages = useCallback(
    (signal: AbortSignal) => client.get<DocumentRecord[]>("/v1/wiki/pages", { signal, params: { active: true } }),
    [client]
  );
  const pages = useAsyncResource(loadPages, [client]);

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

  useEffect(() => {
    if (!selectedPath && visiblePages.length) {
      setSelectedPath(visiblePages[0].path);
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
      .get<WikiPageResponse>(`/v1/wiki/pages/${encodePath(selectedPath)}`, { signal: controller.signal })
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

  function openWikiLink(target: string) {
    const normalized = target.replace(/\\/g, "/").replace(/^wiki\//, "");
    const docs = pages.data ?? [];
    const match = docs.find((doc) => {
      const pathWithoutPrefix = doc.path.replace(/^wiki\//, "");
      return doc.path === target || pathWithoutPrefix === normalized || doc.title === target || doc.path.endsWith(`/${normalized}`);
    });
    if (match) {
      setSelectedPath(match.path);
    } else {
      setFilter(target);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Wiki</p>
          <h1>知识库</h1>
        </div>
        <button className="icon-button" type="button" onClick={refreshWiki} aria-label="刷新 Wiki 列表">
          <RefreshCw size={18} />
        </button>
      </header>

      {pages.error ? <Notice title="无法读取 wiki pages" error={pages.error} /> : null}

      <section className="wiki-layout">
        <aside className="wiki-sidebar">
          <label className="field">
            <span>Filter</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="path 或 title" />
          </label>
          <div className="wiki-list">
            {visiblePages.map((doc) => (
              <button
                className={`wiki-list__item ${selectedPath === doc.path ? "is-selected" : ""}`}
                key={doc.doc_id}
                type="button"
                onClick={() => setSelectedPath(doc.path)}
              >
                <FileText size={16} aria-hidden="true" />
                <span>
                  <strong>{doc.title || basename(doc.path)}</strong>
                  <small>{truncateMiddle(doc.path, 46)}</small>
                </span>
              </button>
            ))}
            {!visiblePages.length ? <EmptyState title="没有匹配页面" /> : null}
          </div>
        </aside>

        <main className="wiki-reader panel">
          {pageLoading ? <EmptyState title="读取页面中" /> : null}
          {pageError ? <Notice title="无法读取页面" error={pageError} /> : null}
          {page ? (
            <>
              <div className="reader-header">
                <div>
                  <div className="reader-header__path">{page.path}</div>
                  <h2>{getMarkdownTitle(page.body) || basename(page.path)}</h2>
                </div>
                <span className="soft-label">
                  {formatUnixSeconds(pages.data?.find((doc) => doc.path === page.path)?.mtime)}
                </span>
              </div>
              <MarkdownView body={page.body} onWikiLink={openWikiLink} />
            </>
          ) : !pageLoading && !pageError ? (
            <EmptyState title="选择一篇 wiki 页面" />
          ) : null}
        </main>
      </section>
    </div>
  );
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
