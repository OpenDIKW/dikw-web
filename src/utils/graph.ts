import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { DocumentRecord, GraphResult, Layer, PageReadResult } from "../types";
import { basename } from "./format";

export interface GraphNode {
  id: string;
  title: string;
  path: string;
  layer: Layer;
  inbound: number;
  outbound: number;
  linkCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  anchor: string | null;
  weight: number;
}

export interface PositionedGraphNode extends GraphNode {
  x: number;
  y: number;
  radius: number;
}

export interface PositionedGraphEdge extends GraphEdge {
  thickness: number;
}

export interface PositionedKnowledgeGraph extends Omit<KnowledgeGraph, "nodes" | "edges"> {
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
}

export interface GraphUnresolvedLink {
  source: string;
  target: string;
  anchor: string | null;
  count: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedLinks: GraphUnresolvedLink[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
  };
}

export interface GraphFilterState {
  layer: Layer | "all";
  query: string;
  hideOrphans: boolean;
}

export interface FilteredKnowledgeGraph extends KnowledgeGraph {
  hiddenNodeIds: Set<string>;
}

export interface GraphLayoutOptions {
  width: number;
  height: number;
  repelStrength: number;
  linkDistance: number;
  nodeSizeScale: number;
  linkThicknessScale: number;
}

interface ParsedWikiLink {
  target: string;
  anchor: string | null;
}

const wikiLinkPattern = /\[\[([^\]\|\n]+?)(?:\|[^\]\n]+?)?\]\]/g;

export function toKnowledgeGraph(result: GraphResult): KnowledgeGraph {
  const usedEdgeIds = new Map<string, number>();
  const nodes = result.nodes.map((node) => ({
    id: node.id,
    title: node.title || basename(node.path).replace(/\.md$/i, ""),
    path: node.path,
    layer: node.layer,
    inbound: node.inbound,
    outbound: node.outbound,
    linkCount: node.inbound + node.outbound
  }));
  const edges = result.edges.map((edge) => {
    const seen = usedEdgeIds.get(edge.id) ?? 0;
    usedEdgeIds.set(edge.id, seen + 1);
    return {
      id: seen === 0 ? edge.id : `${edge.id}::${edge.target_text}::${edge.anchor ?? ""}::${seen}`,
      source: edge.source,
      target: edge.target,
      anchor: edge.anchor,
      weight: edge.weight
    };
  });
  const unresolvedLinks = result.unresolved.map((link) => ({
    source: link.source,
    target: link.target_text,
    anchor: link.anchor,
    count: link.count
  }));

  return {
    nodes,
    edges,
    unresolvedLinks,
    stats: {
      nodeCount: result.stats.node_count,
      edgeCount: result.stats.edge_count,
      unresolvedCount: result.stats.unresolved_count
    }
  };
}

export function buildKnowledgeGraph(pages: DocumentRecord[], bodies: Record<string, PageReadResult | undefined>): KnowledgeGraph {
  const nodeMap = new Map(
    pages.map((page) => [
      page.path,
      {
        id: page.path,
        title: page.title || basename(page.path).replace(/\.md$/i, ""),
        path: page.path,
        layer: page.layer,
        inbound: 0,
        outbound: 0,
        linkCount: 0
      } satisfies GraphNode
    ])
  );
  const edgeMap = new Map<string, GraphEdge>();
  const unresolvedLinks: GraphUnresolvedLink[] = [];

  for (const page of pages) {
    const body = bodies[page.path]?.body ?? "";
    const links = extractWikiLinks(body);
    const outboundTargets = new Set<string>();
    for (const link of links) {
      const target = findPageForTarget(link.target, pages);
      if (!target) {
        unresolvedLinks.push({ source: page.path, target: link.target, anchor: link.anchor, count: 1 });
        continue;
      }
      if (target.path === page.path) {
        continue;
      }

      const edgeId = `${page.path}->${target.path}`;
      const current = edgeMap.get(edgeId);
      if (current) {
        current.weight += 1;
      } else {
        edgeMap.set(edgeId, {
          id: edgeId,
          source: page.path,
          target: target.path,
          anchor: link.anchor,
          weight: 1
        });
      }
      outboundTargets.add(target.path);
    }

    const sourceNode = nodeMap.get(page.path);
    if (sourceNode) {
      sourceNode.outbound = outboundTargets.size;
    }
  }

  for (const edge of edgeMap.values()) {
    const targetNode = nodeMap.get(edge.target);
    if (targetNode) {
      targetNode.inbound += 1;
    }
  }

  const nodes = Array.from(nodeMap.values()).map((node) => ({
    ...node,
    linkCount: node.inbound + node.outbound
  }));
  const edges = Array.from(edgeMap.values());

  return {
    nodes,
    edges,
    unresolvedLinks,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      unresolvedCount: sumUnresolvedCounts(unresolvedLinks)
    }
  };
}

export function extractWikiLinks(body: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const regex = new RegExp(wikiLinkPattern.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const rawTarget = match[1].trim();
    const [target, anchor] = splitAnchor(rawTarget);
    links.push({ target, anchor });
  }
  return links;
}

export function filterKnowledgeGraph(graph: KnowledgeGraph, filters: GraphFilterState): FilteredKnowledgeGraph {
  const query = filters.query.trim().toLowerCase();
  const nodes = graph.nodes.filter((node) => {
    if (filters.layer !== "all" && node.layer !== filters.layer) {
      return false;
    }
    if (filters.hideOrphans && node.linkCount === 0) {
      return false;
    }
    if (query) {
      const haystack = `${node.title} ${node.path}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const hiddenNodeIds = new Set(graph.nodes.filter((node) => !visibleNodeIds.has(node.id)).map((node) => node.id));

  return {
    nodes,
    edges,
    unresolvedLinks: graph.unresolvedLinks.filter((link) => visibleNodeIds.has(link.source)),
    hiddenNodeIds,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      unresolvedCount: sumUnresolvedCounts(graph.unresolvedLinks.filter((link) => visibleNodeIds.has(link.source)))
    }
  };
}

export function layoutKnowledgeGraph(graph: KnowledgeGraph, options: GraphLayoutOptions): PositionedKnowledgeGraph {
  const nodes: Array<GraphNode & SimulationNodeDatum> = graph.nodes.map((node) => ({ ...node }));
  const links: Array<GraphEdge & SimulationLinkDatum<GraphNode & SimulationNodeDatum>> = graph.edges.map((edge) => ({ ...edge }));
  const radiusFor = (node: GraphNode) => graphNodeRadius(node, options.nodeSizeScale);

  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<GraphNode & SimulationNodeDatum, GraphEdge & SimulationLinkDatum<GraphNode & SimulationNodeDatum>>(links)
        .id((node) => node.id)
        .distance(options.linkDistance)
        .strength(0.62)
    )
    .force("charge", forceManyBody().strength(options.repelStrength))
    .force("collide", forceCollide<GraphNode & SimulationNodeDatum>().radius((node) => radiusFor(node) + 8))
    .force("center", forceCenter(options.width / 2, options.height / 2))
    .stop();

  simulation.tick(Math.max(90, nodes.length * 20));
  simulation.stop();

  const positioned = fitNodesToViewport(nodes, options.width, options.height).map((node) => ({
    ...node,
    x: node.x ?? options.width / 2,
    y: node.y ?? options.height / 2,
    radius: radiusFor(node)
  }));

  return {
    ...graph,
    nodes: positioned,
    edges: graph.edges.map((edge) => ({
      ...edge,
      thickness: Math.max(1.15, Math.sqrt(edge.weight) * options.linkThicknessScale)
    }))
  };
}

export function findPageForTarget(target: string, pages: DocumentRecord[]): DocumentRecord | null {
  const normalizedTarget = normalizeTarget(target);
  const exactMatch = pages.find((page) => {
    const candidates = getPageMatchCandidates(page);
    return candidates.includes(normalizedTarget) || normalizeTarget(page.path).endsWith(`/${normalizedTarget}`);
  });
  if (exactMatch) {
    return exactMatch;
  }

  const targetTokens = normalizedTarget.split(/[/-]+/).filter((token) => token.length >= 3);
  const allTokensMatch = findUniqueMatch(pages, (page) =>
    getPageMatchCandidates(page).some((candidate) => targetTokens.length > 0 && targetTokens.every((token) => candidate.includes(token)))
  );
  if (allTokensMatch) {
    return allTokensMatch;
  }

  const lastToken = targetTokens.at(-1);
  if (!lastToken) {
    return null;
  }
  return findUniqueMatch(pages, (page) => getPageMatchCandidates(page).some((candidate) => candidate.includes(lastToken)));
}

function getPageMatchCandidates(page: DocumentRecord): string[] {
  const pathWithoutWiki = page.path.replace(/^wiki\//, "");
  return [page.path, pathWithoutWiki, page.title ?? "", basename(page.path), basename(page.path).replace(/\.md$/i, "")].map(normalizeTarget);
}

function findUniqueMatch(pages: DocumentRecord[], predicate: (page: DocumentRecord) => boolean): DocumentRecord | null {
  const matches = pages.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function normalizeTarget(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^wiki\//, "")
    .replace(/\.md$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function splitAnchor(target: string): [string, string | null] {
  const [path, anchor] = target.split("#", 2);
  return [path.trim(), anchor?.trim() || null];
}


function sumUnresolvedCounts(links: GraphUnresolvedLink[]): number {
  return links.reduce((total, link) => total + link.count, 0);
}

function graphNodeRadius(node: GraphNode, scale: number): number {
  return (7 + Math.sqrt(node.linkCount) * 3.8) * scale;
}

function fitNodesToViewport<T extends SimulationNodeDatum>(nodes: T[], width: number, height: number): Array<T & { x: number; y: number }> {
  const pad = 28;
  const finiteNodes = nodes.map((node) => ({
    ...node,
    x: Number.isFinite(node.x) ? node.x ?? 0 : 0,
    y: Number.isFinite(node.y) ? node.y ?? 0 : 0
  }));
  if (!finiteNodes.length) {
    return [];
  }

  const minX = Math.min(...finiteNodes.map((node) => node.x));
  const maxX = Math.max(...finiteNodes.map((node) => node.x));
  const minY = Math.min(...finiteNodes.map((node) => node.y));
  const maxY = Math.max(...finiteNodes.map((node) => node.y));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const targetWidth = Math.max(width - pad * 2, 1);
  const targetHeight = Math.max(height - pad * 2, 1);
  const scale = Math.min(targetWidth / spanX, targetHeight / spanY, 1);
  const graphWidth = spanX * scale;
  const graphHeight = spanY * scale;
  const offsetX = (width - graphWidth) / 2;
  const offsetY = (height - graphHeight) / 2;

  return finiteNodes.map((node) => ({
    ...node,
    x: clamp(offsetX + (node.x - minX) * scale, 0, width),
    y: clamp(offsetY + (node.y - minY) * scale, 0, height)
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
