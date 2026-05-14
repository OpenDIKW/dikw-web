import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Search, ZoomIn, ZoomOut } from "lucide-react";
import type { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import type { DocumentRecord, Layer, PageReadResult } from "../types";
import { buildKnowledgeGraph, filterKnowledgeGraph, layoutKnowledgeGraph, type KnowledgeGraph } from "../utils/graph";

interface GraphPageProps {
  client: DikwClient;
  onOpenWikiPath?: (path: string) => void;
  pageReadTimeoutMs?: number;
  locale?: Locale;
}

type GraphLayer = Extract<Layer, "wiki" | "source"> | "all";
type GraphCopy = (typeof translations)["en"]["pages"]["graph"];

interface GraphLoadState {
  loading: boolean;
  loaded: number;
  total: number;
  skipped: GraphBodyReadIssue[];
  graph: KnowledgeGraph | null;
  error: unknown;
}

interface GraphBodyReadIssue {
  path: string;
  title: string;
  message: string;
}

interface ForceSettings {
  repelStrength: number;
  linkDistance: number;
  nodeSizeScale: number;
  linkThicknessScale: number;
}

const defaultForceSettings: ForceSettings = {
  repelStrength: -110,
  linkDistance: 96,
  nodeSizeScale: 1,
  linkThicknessScale: 1
};

const graphReadConcurrency = 8;
const defaultPageReadTimeoutMs = 15_000;

export function GraphPage({
  client,
  onOpenWikiPath: _onOpenWikiPath,
  pageReadTimeoutMs = defaultPageReadTimeoutMs,
  locale = "en"
}: GraphPageProps) {
  const copy = translations[locale].pages.graph;
  const [layer, setLayer] = useState<GraphLayer>("wiki");
  const [query, setQuery] = useState("");
  const [hideOrphans, setHideOrphans] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [forces, setForces] = useState<ForceSettings>(defaultForceSettings);
  const [zoom, setZoom] = useState(1);
  const [reloadId, setReloadId] = useState(0);
  const [state, setState] = useState<GraphLoadState>({
    loading: true,
    loaded: 0,
    total: 0,
    skipped: [],
    graph: null,
    error: null
  });

  const loadGraph = useCallback(
    async (signal: AbortSignal) => {
      setState((current) => ({ ...current, loading: true, loaded: 0, total: 0, skipped: [], error: null }));
      const pages = await client.get<DocumentRecord[]>("/v1/base/pages", { signal, params: { active: true } });
      const graphPages = pages.filter((page) => layer === "all" || page.layer === layer);
      setState((current) => ({ ...current, total: graphPages.length }));

      const { bodies, skipped } = await readPageBodies(client, graphPages, signal, pageReadTimeoutMs, () => {
        setState((current) => ({ ...current, loaded: current.loaded + 1 }));
      });

      if (!signal.aborted) {
        setState({
          loading: false,
          loaded: graphPages.length,
          total: graphPages.length,
          skipped,
          graph: buildKnowledgeGraph(graphPages, bodies),
          error: null
        });
      }
    },
    [client, layer, pageReadTimeoutMs]
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
    () => (state.graph ? filterKnowledgeGraph(state.graph, { layer, query, hideOrphans }) : null),
    [hideOrphans, layer, query, state.graph]
  );
  const focusedNodeIds = useMemo(
    () => (filteredGraph && focusedNodeId ? getFocusedNodeIds(filteredGraph, focusedNodeId) : new Set<string>()),
    [filteredGraph, focusedNodeId]
  );
  const focusedNode = filteredGraph?.nodes.find((node) => node.id === focusedNodeId) ?? null;
  const focusedUnresolvedLinks = focusedNodeId ? state.graph?.unresolvedLinks.filter((link) => link.source === focusedNodeId) ?? [] : [];

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <button className="icon-button" type="button" aria-label={copy.refresh} onClick={() => setReloadId((value) => value + 1)}>
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="graph-toolbar panel">
        <div className="segmented-control" aria-label="Graph layer">
          {(["wiki", "source", "all"] satisfies GraphLayer[]).map((value) => (
            <button
              className={layer === value ? "is-active" : ""}
              key={value}
              type="button"
              onClick={() => setLayer(value)}
            >
              {value === "source" ? "Sources" : value === "wiki" ? "Wiki" : "All"}
            </button>
          ))}
        </div>
        <label className="wiki-search graph-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="Graph search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocusedNodeId(null);
            }}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <label className="graph-toggle">
          <input
            aria-label="Hide orphans"
            checked={hideOrphans}
            type="checkbox"
            onChange={(event) => {
              setHideOrphans(event.target.checked);
              setFocusedNodeId(null);
            }}
          />
          <span>{copy.hideOrphans}</span>
        </label>
        {focusedNodeId ? (
          <button className="secondary-button" type="button" onClick={() => setFocusedNodeId(null)}>
            {copy.resetFocus}
          </button>
        ) : null}
        {state.loading ? <span className="soft-label">{formatReadingPages(copy, state.loaded, state.total)}</span> : null}
      </section>

      {state.error ? <Notice title={copy.errorTitle} error={state.error} /> : null}
      {state.skipped.length ? (
        <Notice title={copy.partialReadWarning} tone="warn">
          <div>
            {state.skipped.length} skipped: {state.skipped
              .slice(0, 3)
              .map((issue) => issue.path)
              .join(", ")}
            {state.skipped.length > 3 ? "..." : ""}
          </div>
        </Notice>
      ) : null}

      {filteredGraph ? (
        <section className="graph-layout">
          <main className="graph-canvas panel">
            <div className="graph-canvas__header">
              <div className="graph-stats" aria-label="Graph stats">
                <span className="soft-label">{filteredGraph.stats.nodeCount} nodes</span>
                <span className="soft-label">{filteredGraph.stats.edgeCount} link</span>
                <span className="soft-label">{filteredGraph.stats.unresolvedCount} unresolved</span>
                {state.skipped.length ? <span className="soft-label">{state.skipped.length} skipped</span> : null}
              </div>
              <div className="graph-zoom" aria-label="Graph zoom controls">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setZoom((value) => clampNumber(Number((value - 0.1).toFixed(2)), 0.65, 1.6))}
                >
                  <ZoomOut size={16} />
                </button>
                <button className="icon-button" type="button" aria-label="Reset zoom" onClick={() => setZoom(1)}>
                  <RotateCcw size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setZoom((value) => clampNumber(Number((value + 0.1).toFixed(2)), 0.65, 1.6))}
                >
                  <ZoomIn size={16} />
                </button>
                <span className="soft-label">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="graph-legend" aria-label="Graph legend">
                <span className="graph-legend__chip">
                  <span className="graph-legend__dot" aria-hidden="true" />
                  Wiki
                </span>
                <span className="graph-legend__chip">
                  <span className="graph-legend__dot graph-legend__dot--source" aria-hidden="true" />
                  Source
                </span>
              </div>
            </div>
            {filteredGraph.nodes.length ? (
              <GraphSvg
                graph={filteredGraph}
                focusedNodeIds={focusedNodeIds}
                focusedNodeId={focusedNodeId}
                forces={forces}
                zoom={zoom}
                onSelectNode={setFocusedNodeId}
              />
            ) : (
              <EmptyState title={copy.emptyGraph} />
            )}
            <div className="graph-force-controls" aria-label="Graph force settings">
              <ForceSlider
                label="Repel"
                ariaLabel="Repel strength"
                min={-220}
                max={-30}
                step={10}
                value={forces.repelStrength}
                formatValue={(value) => value.toString()}
                onChange={(value) => setForces((current) => ({ ...current, repelStrength: value }))}
              />
              <ForceSlider
                label="Distance"
                ariaLabel="Link distance"
                min={56}
                max={160}
                step={4}
                value={forces.linkDistance}
                formatValue={(value) => `${value}px`}
                onChange={(value) => setForces((current) => ({ ...current, linkDistance: value }))}
              />
              <ForceSlider
                label="Nodes"
                ariaLabel="Node size"
                min={0.75}
                max={1.4}
                step={0.05}
                value={forces.nodeSizeScale}
                formatValue={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => setForces((current) => ({ ...current, nodeSizeScale: value }))}
              />
              <ForceSlider
                label="Links"
                ariaLabel="Link thickness"
                min={0.75}
                max={2}
                step={0.05}
                value={forces.linkThicknessScale}
                formatValue={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => setForces((current) => ({ ...current, linkThicknessScale: value }))}
              />
            </div>
          </main>
          {focusedNode ? (
            <aside className="graph-detail panel" role="region" aria-label="Graph node detail">
              <div className="reader-header__path">{focusedNode.path}</div>
              <h2>{focusedNode.title}</h2>
              <div className="graph-detail__meta">
                <span className="soft-label">{focusedNode.layer}</span>
                <span className="soft-label">{focusedNode.inbound} inbound</span>
                <span className="soft-label">{focusedNode.outbound} outbound</span>
              </div>
              {focusedUnresolvedLinks.length ? (
                <div className="graph-detail__section">
                  <strong>Unresolved links</strong>
                  {focusedUnresolvedLinks.map((link) => (
                    <span key={`${link.source}-${link.target}`} className="soft-label">
                      {link.target}
                    </span>
                  ))}
                </div>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => _onOpenWikiPath?.(focusedNode.path)}>
                {copy.openInWiki}
              </button>
            </aside>
          ) : null}
        </section>
      ) : !state.loading && !state.error ? (
        <EmptyState title={copy.emptyGraph} />
      ) : null}
    </div>
  );
}

function formatReadingPages(copy: GraphCopy, loaded: number, total: number): string {
  return `${copy.readingPages} ${loaded} / ${total} ${copy.pages}`;
}

function GraphSvg({
  graph,
  focusedNodeIds,
  focusedNodeId,
  forces,
  zoom,
  onSelectNode
}: {
  graph: KnowledgeGraph;
  focusedNodeIds: Set<string>;
  focusedNodeId: string | null;
  forces: ForceSettings;
  zoom: number;
  onSelectNode: (nodeId: string) => void;
}) {
  const width = 720;
  const height = 420;
  const centerX = width / 2;
  const centerY = height / 2;
  const positionedGraph = useMemo(
    () =>
      layoutKnowledgeGraph(graph, {
        width,
        height,
        repelStrength: forces.repelStrength,
        linkDistance: forces.linkDistance,
        nodeSizeScale: forces.nodeSizeScale,
        linkThicknessScale: forces.linkThicknessScale
      }),
    [forces.linkDistance, forces.linkThicknessScale, forces.nodeSizeScale, forces.repelStrength, graph]
  );
  const positions = new Map(positionedGraph.nodes.map((node) => [node.id, node]));

  return (
    <svg className="graph-svg" role="img" aria-label="Knowledge graph" viewBox={`0 0 ${width} ${height}`}>
      <g transform={`translate(${centerX} ${centerY}) scale(${zoom}) translate(${-centerX} ${-centerY})`}>
        <g className="graph-svg__edges">
          {positionedGraph.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) {
              return null;
            }
            const muted = focusedNodeIds.size > 0 && (!focusedNodeIds.has(edge.source) || !focusedNodeIds.has(edge.target));
            return (
              <line
                key={edge.id}
                data-muted={String(muted)}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                strokeWidth={edge.thickness}
              />
            );
          })}
        </g>
        <g className="graph-svg__nodes">
          {positionedGraph.nodes.map((node) => (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.title} graph node`}
              aria-pressed={focusedNodeId === node.id}
              data-layer={node.layer}
              data-muted={String(focusedNodeIds.size > 0 && !focusedNodeIds.has(node.id))}
              transform={`translate(${node.x} ${node.y})`}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectNode(node.id);
                }
              }}
            >
              <circle r={node.radius} />
              <text y={node.radius + 14}>{node.title}</text>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}

function ForceSlider({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  formatValue,
  onChange
}: {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="graph-force-control">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{formatValue(value)}</strong>
    </label>
  );
}

async function readPageBodies(
  client: DikwClient,
  pages: DocumentRecord[],
  signal: AbortSignal,
  timeoutMs: number,
  onLoaded: () => void
): Promise<{ bodies: Record<string, PageReadResult>; skipped: GraphBodyReadIssue[] }> {
  const bodies: Record<string, PageReadResult> = {};
  const skipped: GraphBodyReadIssue[] = [];
  let nextIndex = 0;

  async function worker() {
    while (!signal.aborted) {
      const page = pages[nextIndex];
      nextIndex += 1;
      if (!page) {
        return;
      }
      const result = await readPageBody(client, page, signal, timeoutMs);
      if (signal.aborted) {
        return;
      }
      if (result.ok) {
        bodies[page.path] = result.body;
      } else {
        skipped.push({
          path: page.path,
          title: page.title || page.path,
          message: result.message
        });
      }
      if (!signal.aborted) {
        onLoaded();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(graphReadConcurrency, pages.length) }, () => worker()));
  return { bodies, skipped };
}

async function readPageBody(
  client: DikwClient,
  page: DocumentRecord,
  parentSignal: AbortSignal,
  timeoutMs: number
): Promise<{ ok: true; body: PageReadResult } | { ok: false; message: string }> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    return { ok: false, message: "request aborted" };
  }
  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  let timeoutId: number | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const body = await Promise.race([
      client.get<PageReadResult>(`/v1/base/pages/${encodePath(page.path)}`, { signal: controller.signal }),
      timeout
    ]);
    return { ok: true, body };
  } catch (error) {
    if (parentSignal.aborted) {
      throw error;
    }
    return { ok: false, message: getErrorMessage(error) };
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
