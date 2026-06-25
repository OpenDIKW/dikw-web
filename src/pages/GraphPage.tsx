import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { DikwClient } from "../api/client";
import { GraphCanvas } from "../components/GraphCanvas";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { SoftLabel } from "../components/SoftLabel";
import { translations, type Locale } from "../i18n";
import type { GraphResult } from "../types";
import { filterKnowledgeGraph, toKnowledgeGraph, type KnowledgeGraph } from "../utils/graph";
import { toGalaxyGraph } from "../utils/galaxyGraph";

interface GraphPageProps {
  client: DikwClient;
  onOpenWikiPath?: (path: string) => void;
  locale?: Locale;
}

interface GraphLoadState {
  loading: boolean;
  graph: KnowledgeGraph | null;
  error: unknown;
}

export function GraphPage({
  client,
  onOpenWikiPath: _onOpenWikiPath,
  locale = "en",
}: GraphPageProps) {
  const copy = translations[locale].pages.graph;
  const [query, setQuery] = useState("");
  const [hideOrphans, setHideOrphans] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [reloadId, setReloadId] = useState(0);
  const [state, setState] = useState<GraphLoadState>({
    loading: true,
    graph: null,
    error: null,
  });

  const loadGraph = useCallback(
    async (signal: AbortSignal) => {
      setState((current) => ({ ...current, loading: true, error: null }));
      const graph = await client.get<GraphResult>("/v1/base/graph", {
        signal,
        params: { active: true },
      });

      if (!signal.aborted) {
        setState({
          loading: false,
          graph: toKnowledgeGraph(graph),
          error: null,
        });
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadGraph(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, loading: false, error }));
      }
    });
    return () => controller.abort();
  }, [loadGraph, reloadId]);

  const filteredGraph = useMemo(
    () =>
      state.graph ? filterKnowledgeGraph(state.graph, { layer: "all", query, hideOrphans }) : null,
    [hideOrphans, query, state.graph],
  );
  const galaxyGraph = useMemo(
    () => (filteredGraph ? toGalaxyGraph(filteredGraph) : null),
    [filteredGraph],
  );
  const focusedNodeIds = useMemo(
    () =>
      filteredGraph && focusedNodeId
        ? getFocusedNodeIds(filteredGraph, focusedNodeId)
        : new Set<string>(),
    [filteredGraph, focusedNodeId],
  );
  const focusedNode = filteredGraph?.nodes.find((node) => node.id === focusedNodeId) ?? null;
  const focusedUnresolvedLinks = focusedNodeId
    ? (state.graph?.unresolvedLinks.filter((link) => link.source === focusedNodeId) ?? [])
    : [];

  const resetFocus = useCallback(() => {
    setFocusedNodeId(null);
  }, []);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      if (!filteredGraph) return;
      const node = filteredGraph.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      setFocusedNodeId(nodeId);
    },
    [filteredGraph],
  );

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <IconButton
          label={copy.refresh}
          onClick={() => {
            resetFocus();
            setReloadId((value) => value + 1);
          }}
        >
          <RefreshCw size={18} />
        </IconButton>
      </header>

      <section className="graph-toolbar panel">
        <label className="wiki-search graph-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={copy.searchLabel}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetFocus();
            }}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <label className="graph-toggle">
          <input
            checked={hideOrphans}
            type="checkbox"
            onChange={(event) => {
              setHideOrphans(event.target.checked);
              resetFocus();
            }}
          />
          <span>{copy.hideOrphans}</span>
        </label>
        {state.loading ? <SoftLabel>{copy.loadingGraph}</SoftLabel> : null}
      </section>

      {state.error ? <Notice title={copy.errorTitle} error={state.error} /> : null}

      {filteredGraph ? (
        <section className="graph-layout" data-has-detail={String(Boolean(focusedNode))}>
          <main className="graph-canvas panel">
            <div className="graph-canvas__header">
              <div className="graph-stats" aria-label="Graph stats">
                <SoftLabel>
                  {`${filteredGraph.stats.nodeCount} ${filteredGraph.stats.nodeCount === 1 ? "node" : "nodes"}`}
                </SoftLabel>
                <SoftLabel>
                  {`${filteredGraph.stats.edgeCount} ${filteredGraph.stats.edgeCount === 1 ? "link" : "links"}`}
                </SoftLabel>
                <SoftLabel>{filteredGraph.stats.unresolvedCount} unresolved</SoftLabel>
              </div>
              <div className="graph-legend" aria-label="Graph legend">
                <span className="graph-legend__chip">
                  <span className="graph-legend__dot" aria-hidden="true" />
                  Knowledge
                </span>
                <span className="graph-legend__chip">
                  <span
                    className="graph-legend__dot graph-legend__dot--source"
                    aria-hidden="true"
                  />
                  Source
                </span>
              </div>
            </div>
            {filteredGraph.nodes.length && galaxyGraph ? (
              <GraphCanvas
                graph={galaxyGraph}
                focusedNodeIds={focusedNodeIds}
                focusedNodeId={focusedNodeId}
                onSelectNode={handleSelectNode}
              />
            ) : (
              <EmptyState title={copy.emptyGraph} />
            )}
          </main>
          {focusedNode ? (
            <aside className="graph-detail panel" role="region" aria-label="Graph node detail">
              <div className="reader-header__path">{focusedNode.path}</div>
              <h2>{focusedNode.title}</h2>
              <div className="graph-detail__meta">
                <SoftLabel>{focusedNode.layer}</SoftLabel>
                <SoftLabel>{focusedNode.inbound} inbound</SoftLabel>
                <SoftLabel>{focusedNode.outbound} outbound</SoftLabel>
              </div>
              {focusedUnresolvedLinks.length ? (
                <div className="graph-detail__section">
                  <strong>Unresolved links</strong>
                  {focusedUnresolvedLinks.map((link) => (
                    <SoftLabel key={`${link.source}-${link.target}`}>{link.target}</SoftLabel>
                  ))}
                </div>
              ) : null}
              <Button variant="secondary" onClick={() => _onOpenWikiPath?.(focusedNode.path)}>
                {copy.openInWiki}
              </Button>
            </aside>
          ) : null}
        </section>
      ) : !state.loading && !state.error ? (
        <EmptyState title={copy.emptyGraph} />
      ) : null}
    </div>
  );
}

function getFocusedNodeIds(graph: KnowledgeGraph, nodeId: string): Set<string> {
  const ids = new Set([nodeId]);
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      ids.add(edge.target);
    }
    if (edge.target === nodeId) {
      ids.add(edge.source);
    }
  }
  return ids;
}
