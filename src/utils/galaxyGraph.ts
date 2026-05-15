import type { GraphEdge, GraphNode, KnowledgeGraph } from "./graph";

export interface GalaxyNode extends GraphNode {
  degree: number;
  clusterId: number;
  radius: number;
  labelPriority: number;
}

export interface GalaxyEdge extends GraphEdge {
  thickness: number;
}

export interface GalaxyCluster {
  id: number;
  label: string;
  memberIds: string[];
  color: string;
}

export interface GalaxyGraph {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  clusters: GalaxyCluster[];
  stats: KnowledgeGraph["stats"];
}

export interface PositionedGalaxyNode extends GalaxyNode {
  x: number;
  y: number;
}

export interface PositionedGalaxyCluster extends GalaxyCluster {
  x: number;
  y: number;
  radius: number;
}

export interface PositionedGalaxyGraph extends Omit<GalaxyGraph, "nodes" | "clusters"> {
  nodes: PositionedGalaxyNode[];
  clusters: PositionedGalaxyCluster[];
}

export interface PathResult {
  status: "found" | "unreachable";
  nodeIds: string[];
  edgeIds: string[];
}

const CLUSTER_COLORS = ["#0b6f66", "#6f7f86", "#8b795e", "#2f6f8f", "#7b6d8d", "#62715d", "#9a7355", "#4f7d77"];

export function toGalaxyGraph(graph: KnowledgeGraph): GalaxyGraph {
  const communities = detectCommunities(graph);
  const nodes = graph.nodes.map((node) => {
    const degree = node.inbound + node.outbound;
    return {
      ...node,
      degree,
      clusterId: communities.get(node.id) ?? 0,
      radius: nodeRadius(degree),
      labelPriority: degree * 100 + titleScore(node.title)
    } satisfies GalaxyNode;
  });

  const edges = graph.edges.map((edge) => ({
    ...edge,
    thickness: edgeThickness(edge.weight)
  }));

  return {
    nodes,
    edges,
    clusters: buildClusters(nodes),
    stats: graph.stats
  };
}

export function layoutGalaxyGraph(
  graph: GalaxyGraph,
  { width, height }: { width: number; height: number }
): PositionedGalaxyGraph {
  if (graph.nodes.length === 0) {
    return { ...graph, nodes: [], clusters: [] };
  }

  const clusterCount = Math.max(graph.clusters.length, 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRing = Math.max(120, Math.min(width, height) * 0.34);
  const centroids = new Map<number, { x: number; y: number; radius: number }>();

  graph.clusters.forEach((cluster, index) => {
    const angle = clusterCount === 1 ? 0 : (index / clusterCount) * Math.PI * 2 - Math.PI / 2;
    const radius = 58 + Math.sqrt(cluster.memberIds.length) * 20;
    const ring = clusterCount === 1 ? 0 : maxRing;
    centroids.set(cluster.id, {
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      radius
    });
  });

  const byCluster = new Map<number, GalaxyNode[]>();
  for (const node of graph.nodes) {
    const list = byCluster.get(node.clusterId) ?? [];
    list.push(node);
    byCluster.set(node.clusterId, list);
  }

  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const goldenAngle = 2.399963229728653;

  for (const [clusterId, nodes] of byCluster) {
    const centroid = centroids.get(clusterId) ?? { x: centerX, y: centerY, radius: 160 };
    const sorted = [...nodes].sort((a, b) => b.labelPriority - a.labelPriority || a.id.localeCompare(b.id));
    sorted.forEach((node, index) => {
      const distance = centroid.radius * 0.72 * Math.sqrt((index + 1) / sorted.length);
      const angle = index * goldenAngle;
      positions.set(node.id, {
        x: centroid.x + Math.cos(angle) * distance,
        y: centroid.y + Math.sin(angle) * distance,
        vx: 0,
        vy: 0
      });
    });
  }

  const edgeList = graph.edges.filter((edge) => positions.has(edge.source) && positions.has(edge.target));
  const nodeList = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));

  for (let iteration = 0; iteration < 70; iteration += 1) {
    const forces = new Map<string, { x: number; y: number }>();
    for (const node of nodeList) {
      forces.set(node.id, { x: 0, y: 0 });
    }

    for (const node of nodeList) {
      const position = positions.get(node.id);
      const force = forces.get(node.id);
      const centroid = centroids.get(node.clusterId);
      if (!position || !force || !centroid) continue;
      force.x += (centroid.x - position.x) * 0.018;
      force.y += (centroid.y - position.y) * 0.018;
    }

    for (let i = 0; i < nodeList.length; i += 1) {
      const a = nodeList[i];
      const pa = positions.get(a.id);
      const fa = forces.get(a.id);
      if (!pa || !fa) continue;
      for (let j = i + 1; j < nodeList.length; j += 1) {
        const b = nodeList[j];
        const pb = positions.get(b.id);
        const fb = forces.get(b.id);
        if (!pb || !fb) continue;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy + 4;
        const sameCluster = a.clusterId === b.clusterId;
        const strength = sameCluster ? 760 : 420;
        const mag = strength / d2;
        const inv = 1 / Math.sqrt(d2);
        const fx = dx * inv * mag;
        const fy = dy * inv * mag;
        fa.x += fx;
        fa.y += fy;
        fb.x -= fx;
        fb.y -= fy;
      }
    }

    for (const edge of edgeList) {
      const pa = positions.get(edge.source);
      const pb = positions.get(edge.target);
      if (!pa || !pb) continue;
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      const sameCluster = source?.clusterId === target?.clusterId;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const distance = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const restLength = sameCluster ? 68 : 138;
      const stretch = (distance - restLength) * (sameCluster ? 0.024 : 0.014);
      const fx = (dx / distance) * stretch;
      const fy = (dy / distance) * stretch;
      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (!sourceForce || !targetForce) continue;
      sourceForce.x += fx;
      sourceForce.y += fy;
      targetForce.x -= fx;
      targetForce.y -= fy;
    }

    const cooling = 1 - iteration / 140;
    for (const node of nodeList) {
      const position = positions.get(node.id);
      const force = forces.get(node.id);
      if (!position || !force) continue;
      position.vx = (position.vx + force.x) * 0.72 * cooling;
      position.vy = (position.vy + force.y) * 0.72 * cooling;
      position.x += position.vx;
      position.y += position.vy;
    }
  }

  const fitted = fitPositions(positions, graph.nodes, width, height);
  const positionedNodes = graph.nodes.map((node) => {
    const position = fitted.get(node.id) ?? { x: centerX, y: centerY };
    return { ...node, x: position.x, y: position.y } satisfies PositionedGalaxyNode;
  });

  const positionedClusters = graph.clusters.map((cluster) => {
    const members = positionedNodes.filter((node) => node.clusterId === cluster.id);
    const cx = members.reduce((sum, node) => sum + node.x, 0) / Math.max(members.length, 1);
    const cy = members.reduce((sum, node) => sum + node.y, 0) / Math.max(members.length, 1);
    const radius = Math.max(
      64,
      ...members.map((node) => Math.hypot(node.x - cx, node.y - cy) + node.radius + 26)
    );
    return { ...cluster, x: cx, y: cy, radius } satisfies PositionedGalaxyCluster;
  });

  return {
    ...graph,
    nodes: positionedNodes,
    clusters: positionedClusters
  };
}

export function findShortestPath(graph: KnowledgeGraph, from: string, to: string): PathResult {
  if (from === to) {
    return { status: "found", nodeIds: [from], edgeIds: [] };
  }

  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const edge of graph.edges) {
    const sourceList = adjacency.get(edge.source) ?? [];
    sourceList.push({ nodeId: edge.target, edgeId: edge.id });
    adjacency.set(edge.source, sourceList);
    const targetList = adjacency.get(edge.target) ?? [];
    targetList.push({ nodeId: edge.source, edgeId: edge.id });
    adjacency.set(edge.target, targetList);
  }

  const queue = [from];
  const parent = new Map<string, { nodeId: string | null; edgeId: string | null }>([[from, { nodeId: null, edgeId: null }]]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const neighbors = [...(adjacency.get(current) ?? [])].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    for (const next of neighbors) {
      if (parent.has(next.nodeId)) continue;
      parent.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
      if (next.nodeId === to) {
        return reconstructPath(parent, from, to);
      }
      queue.push(next.nodeId);
    }
  }

  return { status: "unreachable", nodeIds: [], edgeIds: [] };
}

function detectCommunities(graph: KnowledgeGraph): Map<string, number> {
  if (!graph.edges.length) {
    return fallbackCommunities(graph.nodes);
  }

  const nodeIds = graph.nodes.map((node) => node.id).sort();
  const indexById = new Map(nodeIds.map((id, index) => [id, index]));
  const adjacency = new Map<string, Map<string, number>>();
  const degree = new Map<string, number>();
  let totalWeight = 0;

  for (const edge of graph.edges) {
    if (!indexById.has(edge.source) || !indexById.has(edge.target)) continue;
    const weight = Math.max(edge.weight, 1);
    addWeight(adjacency, edge.source, edge.target, weight);
    addWeight(adjacency, edge.target, edge.source, weight);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + weight);
    totalWeight += weight;
  }

  const communities = new Map<string, number>();
  const communityDegree = new Map<number, number>();
  nodeIds.forEach((id, index) => {
    communities.set(id, index);
    communityDegree.set(index, degree.get(id) ?? 0);
  });

  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (const nodeId of nodeIds) {
      const currentCommunity = communities.get(nodeId) ?? 0;
      const nodeDegree = degree.get(nodeId) ?? 0;
      const neighborCommunities = new Map<number, number>();
      for (const [neighborId, weight] of adjacency.get(nodeId) ?? []) {
        const community = communities.get(neighborId) ?? 0;
        neighborCommunities.set(community, (neighborCommunities.get(community) ?? 0) + weight);
      }

      let bestCommunity = currentCommunity;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const [community, inWeight] of [...neighborCommunities].sort((a, b) => a[0] - b[0])) {
        const score = inWeight - (nodeDegree * (communityDegree.get(community) ?? 0)) / Math.max(totalWeight * 2, 1);
        if (score > bestScore) {
          bestScore = score;
          bestCommunity = community;
        }
      }

      if (bestCommunity !== currentCommunity) {
        communityDegree.set(currentCommunity, (communityDegree.get(currentCommunity) ?? 0) - nodeDegree);
        communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) ?? 0) + nodeDegree);
        communities.set(nodeId, bestCommunity);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const renumbered = renumberCommunities(communities);
  const uniqueCount = new Set(renumbered.values()).size;
  if (uniqueCount > Math.max(8, Math.ceil(graph.nodes.length / 3))) {
    return fallbackCommunities(graph.nodes);
  }
  return renumbered;
}

function fallbackCommunities(nodes: GraphNode[]): Map<string, number> {
  const keyToCommunity = new Map<string, number>();
  const output = new Map<string, number>();
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const parts = node.path.split("/");
    const key = `${node.layer}:${parts[1] ?? "root"}`;
    if (!keyToCommunity.has(key)) {
      keyToCommunity.set(key, keyToCommunity.size);
    }
    output.set(node.id, keyToCommunity.get(key) ?? 0);
  }
  return output;
}

function renumberCommunities(communities: Map<string, number>): Map<string, number> {
  const oldToNew = new Map<number, number>();
  const output = new Map<string, number>();
  for (const [nodeId, community] of [...communities].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!oldToNew.has(community)) {
      oldToNew.set(community, oldToNew.size);
    }
    output.set(nodeId, oldToNew.get(community) ?? 0);
  }
  return output;
}

function buildClusters(nodes: GalaxyNode[]): GalaxyCluster[] {
  const groups = new Map<number, GalaxyNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.clusterId) ?? [];
    list.push(node);
    groups.set(node.clusterId, list);
  }

  return [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([id, members]) => {
      const sorted = [...members].sort((a, b) => b.labelPriority - a.labelPriority || a.id.localeCompare(b.id));
      return {
        id,
        label: sorted[0]?.title ?? sorted[0]?.path ?? `Cluster ${id + 1}`,
        memberIds: sorted.map((node) => node.id),
        color: CLUSTER_COLORS[id % CLUSTER_COLORS.length]
      } satisfies GalaxyCluster;
    });
}

function addWeight(adjacency: Map<string, Map<string, number>>, source: string, target: string, weight: number): void {
  const neighbors = adjacency.get(source) ?? new Map<string, number>();
  neighbors.set(target, (neighbors.get(target) ?? 0) + weight);
  adjacency.set(source, neighbors);
}

function reconstructPath(
  parent: Map<string, { nodeId: string | null; edgeId: string | null }>,
  from: string,
  to: string
): PathResult {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let current: string | null = to;
  while (current) {
    nodeIds.push(current);
    const next = parent.get(current);
    if (next?.edgeId) {
      edgeIds.push(next.edgeId);
    }
    current = next?.nodeId ?? null;
  }
  nodeIds.reverse();
  edgeIds.reverse();
  if (nodeIds[0] !== from) {
    return { status: "unreachable", nodeIds: [], edgeIds: [] };
  }
  return { status: "found", nodeIds, edgeIds };
}

function nodeRadius(degree: number): number {
  return 8 + Math.sqrt(Math.max(degree, 0)) * 4.2;
}

function edgeThickness(weight: number): number {
  return 0.8 + Math.sqrt(Math.max(weight, 1)) * 0.55;
}

function titleScore(title: string): number {
  return Math.max(0, 80 - title.length);
}

function fitPositions(
  positions: Map<string, { x: number; y: number }>,
  nodes: GalaxyNode[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const margin = 42;
  const xs = nodes.map((node) => positions.get(node.id)?.x ?? width / 2);
  const ys = nodes.map((node) => positions.get(node.id)?.y ?? height / 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY, 1.35);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const output = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const position = positions.get(node.id) ?? { x: width / 2, y: height / 2 };
    output.set(node.id, {
      x: offsetX + (position.x - minX) * scale,
      y: offsetY + (position.y - minY) * scale
    });
  }
  return output;
}
