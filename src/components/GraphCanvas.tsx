import { useEffect, useMemo, useRef, useState } from "react";
import {
  layoutGalaxyGraph,
  type GalaxyGraph,
  type PositionedGalaxyGraph,
  type PositionedGalaxyNode
} from "../utils/galaxyGraph";

interface GraphCanvasProps {
  graph: GalaxyGraph;
  focusedNodeIds: Set<string>;
  focusedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

interface GraphPalette {
  accent: number;
  source: number;
  text: number;
  muted: number;
  surface: number;
  line: number;
}

interface PixiEngine {
  render(graph: PositionedGalaxyGraph, state: RenderState): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

interface RenderState {
  focusedNodeIds: Set<string>;
  focusedNodeId: string | null;
  palette: GraphPalette;
}

const defaultWidth = 900;
const defaultHeight = 520;
const LARGE_GRAPH_NODE_COUNT = 200;

export function GraphCanvas({
  graph,
  focusedNodeIds,
  focusedNodeId,
  onSelectNode
}: GraphCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PixiEngine | null>(null);
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const [pixiReady, setPixiReady] = useState(false);

  const positionedGraph = useMemo(
    () => layoutGalaxyGraph(graph, { width: size.width, height: size.height }),
    [graph, size.height, size.width]
  );

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(Math.round(entry.contentRect.width), 320);
      const height = Math.max(Math.round(entry.contentRect.height), 360);
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let active = true;
    createPixiGraphEngine(mount)
      .then((engine) => {
        if (!active) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        engine.resize(size.width, size.height);
        setPixiReady(true);
      })
      .catch(() => {
        if (active) {
          setPixiReady(false);
        }
      });

    return () => {
      active = false;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !stageRef.current) return;
    engine.resize(size.width, size.height);
    engine.render(positionedGraph, {
      focusedNodeIds,
      focusedNodeId,
      palette: readPalette(stageRef.current)
    });
  }, [focusedNodeId, focusedNodeIds, positionedGraph, size.height, size.width]);

  useEffect(() => {
    if (navigator.userAgent.toLowerCase().includes("jsdom") || !stageRef.current) return;
    const canvas = fallbackCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawFallbackCanvas(context, positionedGraph, {
      focusedNodeIds,
      focusedNodeId,
      palette: readPalette(stageRef.current)
    });
  }, [focusedNodeId, focusedNodeIds, positionedGraph, size.height, size.width]);

  return (
    <div ref={stageRef} className="graph-pixi-stage" role="img" aria-label="Knowledge graph">
      <canvas ref={fallbackCanvasRef} className="graph-fallback-canvas" aria-hidden="true" />
      <div ref={mountRef} className="graph-pixi-mount" data-ready={String(pixiReady)} />
      {!pixiReady ? (
        <FallbackGraphSvg graph={positionedGraph} focusedNodeIds={focusedNodeIds} />
      ) : null}
      <div className="graph-node-hit-layer" aria-hidden={false}>
        {positionedGraph.nodes.map((node) => (
          <button
            key={node.id}
            className="graph-node-hit"
            type="button"
            aria-label={`${node.title} graph node`}
            aria-pressed={focusedNodeId === node.id}
            data-muted={String(isNodeMuted(node.id, focusedNodeIds))}
            data-layer={node.layer}
            style={{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${Math.max(node.radius * 2 + 10, 28)}px`,
              height: `${Math.max(node.radius * 2 + 10, 28)}px`
            }}
            onClick={() => onSelectNode(node.id)}
          />
        ))}
      </div>
    </div>
  );
}

function drawFallbackCanvas(
  context: CanvasRenderingContext2D,
  graph: PositionedGalaxyGraph,
  state: RenderState
): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = context.canvas.width / ratio;
  const height = context.canvas.height / ratio;
  context.clearRect(0, 0, width, height);
  context.fillStyle = numberToRgba(state.palette.surface, 0.22);
  context.fillRect(0, 0, width, height);
  const largeGraph = graph.nodes.length >= LARGE_GRAPH_NODE_COUNT;

  for (const cluster of graph.clusters) {
    context.beginPath();
    context.ellipse(cluster.x, cluster.y, cluster.radius * 0.96, cluster.radius * 0.58, 0, 0, Math.PI * 2);
    context.fillStyle = `${cluster.color}${largeGraph ? "04" : "12"}`;
    context.fill();
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;
    const focused = state.focusedNodeIds.size > 0 && state.focusedNodeIds.has(edge.source) && state.focusedNodeIds.has(edge.target);
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    const idleAlpha = largeGraph ? 0.035 : 0.32;
    context.strokeStyle = numberToRgba(
      state.palette.line,
      state.focusedNodeIds.size ? (focused ? (largeGraph ? 0.42 : 0.58) : largeGraph ? 0.035 : 0.09) : idleAlpha
    );
    context.lineWidth = edge.thickness;
    context.lineCap = "round";
    context.stroke();
  }

  for (const node of graph.nodes) {
    const muted = isNodeMuted(node.id, state.focusedNodeIds);
    const color = node.layer === "source" ? state.palette.source : state.palette.accent;
    const selected = state.focusedNodeId === node.id;
    context.beginPath();
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    context.fillStyle = numberToRgba(color, muted ? 0.18 : 1);
    context.fill();
    context.strokeStyle = numberToRgba(state.palette.surface, selected ? 0.96 : 0.8);
    context.lineWidth = selected ? (largeGraph ? 1.7 : 2.4) : largeGraph ? 0.75 : 1.4;
    context.stroke();
  }
}

async function createPixiGraphEngine(mount: HTMLElement): Promise<PixiEngine> {
  if (navigator.userAgent.toLowerCase().includes("jsdom")) {
    throw new Error("Pixi canvas is disabled in jsdom");
  }
  const pixi = await import("pixi.js");
  const app = new pixi.Application();
  await app.init({
    resizeTo: mount,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: "high-performance"
  });
  mount.replaceChildren(app.canvas);
  return new PixiGraphEngine(app, pixi);
}

class PixiGraphEngine implements PixiEngine {
  private world: import("pixi.js").Container;
  private nebulaLayer: import("pixi.js").Container;
  private edgeLayer: import("pixi.js").Graphics;
  private nodeLayer: import("pixi.js").Graphics;
  private labelLayer: import("pixi.js").Container;
  private scale = 1;
  private x = 0;
  private y = 0;
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private cameraStart = { x: 0, y: 0 };
  private removeListeners: Array<() => void> = [];

  constructor(
    private app: import("pixi.js").Application,
    private pixi: typeof import("pixi.js")
  ) {
    this.world = new pixi.Container();
    this.nebulaLayer = new pixi.Container();
    this.edgeLayer = new pixi.Graphics();
    this.nodeLayer = new pixi.Graphics();
    this.labelLayer = new pixi.Container();

    this.world.addChild(this.nebulaLayer);
    this.world.addChild(this.edgeLayer);
    this.world.addChild(this.nodeLayer);
    this.world.addChild(this.labelLayer);
    this.app.stage.addChild(this.world);
    this.installCamera();
  }

  render(graph: PositionedGalaxyGraph, state: RenderState): void {
    this.edgeLayer.clear();
    this.nodeLayer.clear();
    this.labelLayer.removeChildren();
    this.nebulaLayer.removeChildren();

    const largeGraph = graph.nodes.length >= LARGE_GRAPH_NODE_COUNT;

    for (const cluster of graph.clusters) {
      const nebula = new this.pixi.Graphics();
      nebula.ellipse(cluster.x, cluster.y, cluster.radius * 0.96, cluster.radius * 0.58);
      nebula.fill({ color: parseHex(cluster.color), alpha: largeGraph ? 0.012 : 0.065 });
      this.nebulaLayer.addChild(nebula);
    }

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      const focused = state.focusedNodeIds.size > 0 && state.focusedNodeIds.has(edge.source) && state.focusedNodeIds.has(edge.target);
      const idleAlpha = largeGraph ? 0.035 : 0.33;
      const alpha = state.focusedNodeIds.size
        ? focused
          ? largeGraph
            ? 0.42
            : 0.58
          : largeGraph
            ? 0.035
            : 0.09
        : idleAlpha;
      this.edgeLayer.moveTo(source.x, source.y);
      this.edgeLayer.lineTo(target.x, target.y);
      this.edgeLayer.stroke({ color: state.palette.line, width: edge.thickness, alpha });
    }

    const topLabels = new Set(
      [...graph.nodes]
        .sort((a, b) => b.labelPriority - a.labelPriority || a.id.localeCompare(b.id))
        .slice(0, largeGraph ? 5 : 18)
        .map((node) => node.id)
    );

    for (const node of graph.nodes) {
      const muted = isNodeMuted(node.id, state.focusedNodeIds);
      const color = node.layer === "source" ? state.palette.source : state.palette.accent;
      const selected = state.focusedNodeId === node.id;
      const alpha = muted ? 0.16 : 1;

      this.nodeLayer.circle(node.x, node.y, node.radius);
      this.nodeLayer.fill({ color, alpha });
      this.nodeLayer.circle(node.x, node.y, node.radius);
      this.nodeLayer.stroke({
        color: state.palette.surface,
        width: selected ? (largeGraph ? 1.7 : 2.4) : largeGraph ? 0.75 : 1.4,
        alpha: selected ? 0.95 : 0.82
      });

      if (selected || topLabels.has(node.id)) {
        const label = new this.pixi.Text({
          text: node.title,
          style: {
            fill: state.palette.text,
            fontSize: selected ? 12 : 10,
            fontWeight: selected ? "600" : "500",
            fontFamily: "Inter, ui-sans-serif, system-ui"
          }
        });
        label.anchor.set(0.5, 0);
        label.x = node.x;
        label.y = node.y + node.radius + 8;
        label.alpha = muted ? 0.24 : 0.92;
        this.labelLayer.addChild(label);
      }
    }
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
  }

  destroy(): void {
    for (const remove of this.removeListeners) {
      remove();
    }
    this.removeListeners = [];
    this.app.destroy(true, { children: true });
  }

  private installCamera(): void {
    const canvas = this.app.canvas;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const before = this.screenToWorld(px, py);
      const delta = event.deltaY > 0 ? 0.92 : 1.08;
      this.scale = clamp(this.scale * delta, 0.55, 2.4);
      this.x = px - before.x * this.scale;
      this.y = py - before.y * this.scale;
      this.applyCamera();
    };
    const onPointerDown = (event: PointerEvent) => {
      this.dragging = true;
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.cameraStart = { x: this.x, y: this.y };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!this.dragging) return;
      this.x = this.cameraStart.x + event.clientX - this.dragStart.x;
      this.y = this.cameraStart.y + event.clientY - this.dragStart.y;
      this.applyCamera();
    };
    const onPointerUp = (event: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    this.removeListeners.push(
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("pointerdown", onPointerDown),
      () => canvas.removeEventListener("pointermove", onPointerMove),
      () => canvas.removeEventListener("pointerup", onPointerUp),
      () => canvas.removeEventListener("pointercancel", onPointerUp)
    );
  }

  private applyCamera(): void {
    this.world.scale.set(this.scale);
    this.world.position.set(this.x, this.y);
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.x) / this.scale,
      y: (y - this.y) / this.scale
    };
  }
}

function FallbackGraphSvg({
  graph,
  focusedNodeIds
}: {
  graph: PositionedGalaxyGraph;
  focusedNodeIds: Set<string>;
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <svg className="graph-fallback-svg" viewBox={`0 0 ${defaultWidth} ${defaultHeight}`} aria-hidden="true">
      <g>
        {graph.edges.map((edge) => {
          const source = nodes.get(edge.source);
          const target = nodes.get(edge.target);
          if (!source || !target) return null;
          const muted = focusedNodeIds.size > 0 && (!focusedNodeIds.has(edge.source) || !focusedNodeIds.has(edge.target));
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              data-muted={String(muted)}
            />
          );
        })}
      </g>
      <g>
        {graph.nodes.map((node) => (
          <circle key={node.id} cx={node.x} cy={node.y} r={node.radius} data-layer={node.layer} />
        ))}
      </g>
    </svg>
  );
}

function readPalette(element: HTMLElement): GraphPalette {
  const style = getComputedStyle(element);
  return {
    accent: cssColorToNumber(style.getPropertyValue("--accent") || "#0b6f66"),
    source: cssColorToNumber("#7f8888"),
    text: cssColorToNumber(style.getPropertyValue("--text") || "#18211f"),
    muted: cssColorToNumber(style.getPropertyValue("--muted") || "#66736f"),
    surface: cssColorToNumber(style.getPropertyValue("--surface") || "#fbfaf6"),
    line: cssColorToNumber(style.getPropertyValue("--line-strong") || "#b9c7c2")
  };
}

function cssColorToNumber(value: string): number {
  const text = value.trim();
  if (text.startsWith("#")) {
    return parseHex(text);
  }
  const match = text.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return 0x0b6f66;
  }
  return (Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3]);
}

function parseHex(value: string): number {
  const hex = value.replace("#", "").trim();
  if (hex.length === 3) {
    return Number.parseInt(hex.split("").map((char) => char + char).join(""), 16);
  }
  return Number.parseInt(hex.slice(0, 6), 16);
}

function numberToRgba(value: number, alpha: number): string {
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isNodeMuted(nodeId: string, focusedNodeIds: Set<string>): boolean {
  if (focusedNodeIds.size > 0) {
    return !focusedNodeIds.has(nodeId);
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
