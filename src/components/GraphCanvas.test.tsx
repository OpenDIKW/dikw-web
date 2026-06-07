import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "./GraphCanvas";
import { toGalaxyGraph } from "../utils/galaxyGraph";
import type { KnowledgeGraph } from "../utils/graph";

const tinyKnowledgeGraph: KnowledgeGraph = {
  nodes: [
    {
      id: "a",
      title: "A",
      path: "knowledge/a.md",
      layer: "knowledge",
      inbound: 0,
      outbound: 1,
      linkCount: 1,
    },
    {
      id: "b",
      title: "B",
      path: "knowledge/b.md",
      layer: "knowledge",
      inbound: 1,
      outbound: 0,
      linkCount: 1,
    },
  ],
  edges: [{ id: "a->b", source: "a", target: "b", anchor: null, weight: 1 }],
  stats: { nodeCount: 2, edgeCount: 1, unresolvedCount: 0 },
  unresolvedLinks: [],
};

function mockResizeObserverWithSize(width: number, height: number) {
  const callbacks: ResizeObserverCallback[] = [];
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb);
    }
    observe(target: Element) {
      const cb = callbacks[callbacks.length - 1];
      if (!cb) return;
      const entry = {
        target,
        contentRect: {
          width,
          height,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;
      cb([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
}

describe("GraphCanvas SVG fallback geometry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SVG viewBox tracks the resized stage dimensions instead of a hardcoded 900x520", async () => {
    mockResizeObserverWithSize(1400, 900);
    const galaxyGraph = toGalaxyGraph(tinyKnowledgeGraph);

    await act(async () => {
      render(
        <GraphCanvas
          graph={galaxyGraph}
          focusedNodeIds={new Set()}
          focusedNodeId={null}
          onSelectNode={() => {}}
        />,
      );
    });

    const svg = document.querySelector(".graph-fallback-svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 1400 900");
  });
});
