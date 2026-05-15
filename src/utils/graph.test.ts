import { describe, expect, it } from "vitest";
import type { DocumentRecord, GraphResult, PageReadResult } from "../types";
import { buildKnowledgeGraph, filterKnowledgeGraph, layoutKnowledgeGraph, toKnowledgeGraph } from "./graph";
import { findShortestPath, layoutGalaxyGraph, toGalaxyGraph } from "./galaxyGraph";

const pages: DocumentRecord[] = [
  {
    doc_id: "wiki-architecture",
    path: "wiki/architecture.md",
    path_key: "wiki/architecture.md",
    title: "Architecture",
    hash: "hash-a",
    mtime: 1777819200,
    layer: "wiki",
    active: true
  },
  {
    doc_id: "wiki-synthesis",
    path: "wiki/synthesis.md",
    path_key: "wiki/synthesis.md",
    title: "Synthesis",
    hash: "hash-s",
    mtime: 1777819300,
    layer: "wiki",
    active: true
  },
  {
    doc_id: "wiki-orphan",
    path: "wiki/orphan.md",
    path_key: "wiki/orphan.md",
    title: "Orphan",
    hash: "hash-o",
    mtime: 1777819400,
    layer: "wiki",
    active: true
  },
  {
    doc_id: "source-brief",
    path: "sources/brief.md",
    path_key: "sources/brief.md",
    title: "Source Brief",
    hash: "hash-src",
    mtime: 1777819500,
    layer: "source",
    active: true
  }
];

const bodies: Record<string, PageReadResult> = {
  "wiki/architecture.md": {
    doc_id: "wiki-architecture",
    path: "wiki/architecture.md",
    layer: "wiki",
    title: "Architecture",
    body: "# Architecture\n\nSee [[Synthesis#Details|the synthesis page]] and again [[Synthesis#Details]]. Missing [[Missing Concept]].",
    anchors: []
  },
  "wiki/synthesis.md": {
    doc_id: "wiki-synthesis",
    path: "wiki/synthesis.md",
    layer: "wiki",
    title: "Synthesis",
    body: "# Synthesis\n\nSynthesis Body.",
    anchors: []
  },
  "wiki/orphan.md": {
    doc_id: "wiki-orphan",
    path: "wiki/orphan.md",
    layer: "wiki",
    title: "Orphan",
    body: "# Orphan\n\nNo links.",
    anchors: []
  },
  "sources/brief.md": {
    doc_id: "source-brief",
    path: "sources/brief.md",
    layer: "source",
    title: "Source Brief",
    body: "# Source Brief\n\nSource-only page.",
    anchors: []
  }
};

describe("knowledge graph builder", () => {
  it("adapts the core graph endpoint payload into the render graph", () => {
    const coreGraph: GraphResult = {
      base_revision: "graph-rev-1",
      generated_at: "2026-05-14T10:00:00Z",
      nodes: [
        {
          id: "wiki/architecture.md",
          path: "wiki/architecture.md",
          title: "Architecture",
          layer: "wiki",
          active: true,
          mtime: 1777819200,
          inbound: 0,
          outbound: 1
        },
        {
          id: "wiki/synthesis.md",
          path: "wiki/synthesis.md",
          title: "Synthesis",
          layer: "wiki",
          active: true,
          mtime: 1777819300,
          inbound: 1,
          outbound: 0
        }
      ],
      edges: [
        {
          id: "wiki/architecture.md->wiki/synthesis.md",
          source: "wiki/architecture.md",
          target: "wiki/synthesis.md",
          type: "wikilink",
          target_text: "Synthesis",
          anchor: "Details",
          weight: 3
        }
      ],
      unresolved: [
        {
          source: "wiki/architecture.md",
          target_text: "Missing Concept",
          anchor: null,
          count: 2
        }
      ],
      stats: {
        node_count: 2,
        edge_count: 1,
        unresolved_count: 2
      }
    };

    const graph = toKnowledgeGraph(coreGraph);

    expect(graph.stats).toEqual({ nodeCount: 2, edgeCount: 1, unresolvedCount: 2 });
    expect(graph.nodes[0]).toMatchObject({
      id: "wiki/architecture.md",
      title: "Architecture",
      path: "wiki/architecture.md",
      layer: "wiki",
      inbound: 0,
      outbound: 1,
      linkCount: 1
    });
    expect(graph.edges[0]).toMatchObject({
      id: "wiki/architecture.md->wiki/synthesis.md",
      source: "wiki/architecture.md",
      target: "wiki/synthesis.md",
      anchor: "Details",
      weight: 3
    });
    expect(graph.unresolvedLinks).toEqual([
      {
        source: "wiki/architecture.md",
        target: "Missing Concept",
        anchor: null,
        count: 2
      }
    ]);
  });

  it("builds nodes and deduplicated resolved wikilink edges while retaining unresolved links", () => {
    const graph = buildKnowledgeGraph(pages, bodies);

    expect(graph.stats).toMatchObject({ nodeCount: 4, edgeCount: 1, unresolvedCount: 1 });
    expect(graph.nodes.find((node) => node.id === "wiki/architecture.md")).toMatchObject({
      title: "Architecture",
      outbound: 1,
      inbound: 0,
      linkCount: 1
    });
    expect(graph.nodes.find((node) => node.id === "wiki/synthesis.md")).toMatchObject({
      title: "Synthesis",
      outbound: 0,
      inbound: 1,
      linkCount: 1
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: "wiki/architecture.md->wiki/synthesis.md",
        source: "wiki/architecture.md",
        target: "wiki/synthesis.md",
        anchor: "Details",
        weight: 2
      })
    ]);
    expect(graph.unresolvedLinks).toEqual([
      expect.objectContaining({
        source: "wiki/architecture.md",
        target: "Missing Concept"
      })
    ]);
  });

  it("filters graph nodes by layer, search query, and orphan visibility", () => {
    const graph = buildKnowledgeGraph(pages, bodies);

    expect(
      filterKnowledgeGraph(graph, {
        layer: "wiki",
        query: "",
        hideOrphans: true
      }).nodes.map((node) => node.id)
    ).toEqual(["wiki/architecture.md", "wiki/synthesis.md"]);

    expect(
      filterKnowledgeGraph(graph, {
        layer: "all",
        query: "source",
        hideOrphans: false
      }).nodes.map((node) => node.id)
    ).toEqual(["sources/brief.md"]);
  });

  it("computes bounded force-layout coordinates without mutating graph nodes", () => {
    const graph = buildKnowledgeGraph(pages, bodies);
    const layout = layoutKnowledgeGraph(graph, {
      width: 600,
      height: 360,
      repelStrength: -90,
      linkDistance: 96,
      nodeSizeScale: 1,
      linkThicknessScale: 1
    });

    expect(layout.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(600);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(360);
    }
    expect("x" in graph.nodes[0]).toBe(false);
  });

  it("derives a deterministic galaxy graph with visual clusters from the render graph", () => {
    const graph = buildKnowledgeGraph(pages, bodies);
    const first = toGalaxyGraph(graph);
    const second = toGalaxyGraph(graph);

    expect(first).toEqual(second);
    expect(first.nodes.find((node) => node.id === "wiki/architecture.md")).toMatchObject({
      degree: 1,
      layer: "wiki",
      radius: expect.any(Number),
      clusterId: expect.any(Number)
    });
    expect(first.nodes.find((node) => node.id === "sources/brief.md")).toMatchObject({
      degree: 0,
      layer: "source"
    });
    expect(first.edges[0]).toMatchObject({
      source: "wiki/architecture.md",
      target: "wiki/synthesis.md",
      weight: 2,
      thickness: expect.any(Number)
    });
    expect(first.clusters.length).toBeGreaterThanOrEqual(1);
    expect(first.clusters[0]).toMatchObject({
      id: expect.any(Number),
      label: expect.any(String),
      memberIds: expect.any(Array)
    });
  });

  it("lays out galaxy clusters without mutating graph nodes", () => {
    const graph = toGalaxyGraph(buildKnowledgeGraph(pages, bodies));
    const layout = layoutGalaxyGraph(graph, { width: 900, height: 520 });

    expect(layout.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(900);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(520);
    }
    expect("x" in graph.nodes[0]).toBe(false);
  });

  it("finds shortest paths for graph path mode", () => {
    const graph = buildKnowledgeGraph(pages, bodies);

    expect(findShortestPath(graph, "wiki/architecture.md", "wiki/synthesis.md")).toEqual({
      status: "found",
      nodeIds: ["wiki/architecture.md", "wiki/synthesis.md"],
      edgeIds: ["wiki/architecture.md->wiki/synthesis.md"]
    });
    expect(findShortestPath(graph, "wiki/architecture.md", "wiki/architecture.md")).toEqual({
      status: "found",
      nodeIds: ["wiki/architecture.md"],
      edgeIds: []
    });
    expect(findShortestPath(graph, "wiki/architecture.md", "sources/brief.md")).toEqual({
      status: "unreachable",
      nodeIds: [],
      edgeIds: []
    });
  });
});
