import type { EChartsOption } from "echarts";

export type ChartType = "bar" | "heatmap" | "line" | "scatter";

export interface ChartSpec {
  type: ChartType;
  headers: string[];
  rows: string[][];
  freeText: string[];
}

const ALIGNMENT_CELL = /^:?-+:?$/;

function isPipeRow(line: string): boolean {
  return line.includes("|");
}

function isAlignmentRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => ALIGNMENT_CELL.test(cell.trim()));
}

export function parseChartFromDetails(content: string, type: ChartType): ChartSpec | null {
  const lines = content.split("\n").map((line) => line.replace(/\s+$/, ""));
  const tableLines: string[] = [];
  const freeText: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (isPipeRow(line)) {
      tableLines.push(line);
      inTable = true;
      continue;
    }
    if (inTable && line.trim() === "") {
      inTable = false;
      continue;
    }
    if (line.trim() !== "") {
      freeText.push(line.trim());
    }
  }

  if (tableLines.length < 2) {
    return null;
  }

  const cells = tableLines.map(splitPipeRow);
  const headers = cells[0];
  const remaining = cells.slice(1);
  const dataRows = remaining.filter((row) => !isAlignmentRow(row));
  if (dataRows.length === 0) {
    return null;
  }

  return {
    type,
    headers,
    rows: dataRows,
    freeText,
  };
}

function splitPipeRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

const LEADING_NUMERIC = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;

function toNumber(cell: string): number | null {
  const match = cell.match(LEADING_NUMERIC);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildCategoryOption(spec: ChartSpec, seriesType: "bar" | "line"): EChartsOption {
  const categories = spec.rows.map((row) => row[0]);
  const values = spec.rows.map((row) => toNumber(row[1] ?? ""));
  const series: Record<string, unknown> = {
    type: seriesType,
    data: values,
    name: spec.headers[1] ?? "value",
  };
  if (seriesType === "line") {
    series.smooth = true;
  }
  return {
    grid: { left: 48, right: 24, top: 32, bottom: 40, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: categories, name: spec.headers[0] ?? "" },
    yAxis: { type: "value", name: spec.headers[1] ?? "" },
    series: [series],
  } as EChartsOption;
}

export function buildBarOption(spec: ChartSpec): EChartsOption {
  return buildCategoryOption(spec, "bar");
}

export function buildLineOption(spec: ChartSpec): EChartsOption {
  return buildCategoryOption(spec, "line");
}

export function buildScatterOption(spec: ChartSpec): EChartsOption {
  const points = spec.rows
    .map((row) => [toNumber(row[0] ?? ""), toNumber(row[1] ?? "")])
    .filter((point): point is [number, number] => point[0] !== null && point[1] !== null);
  return {
    grid: { left: 48, right: 24, top: 32, bottom: 40, containLabel: true },
    tooltip: { trigger: "item" },
    xAxis: { type: "value", name: spec.headers[0] ?? "" },
    yAxis: { type: "value", name: spec.headers[1] ?? "" },
    series: [
      {
        type: "scatter",
        data: points,
        name: spec.headers[1] ?? "value",
      },
    ],
  };
}

export function buildHeatmapOption(spec: ChartSpec): EChartsOption {
  const xLabels = spec.headers.slice(1);
  const yLabels = spec.rows.map((row) => row[0]);
  const data: Array<[number, number, number | null]> = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < spec.rows.length; y += 1) {
    const row = spec.rows[y];
    for (let x = 0; x < xLabels.length; x += 1) {
      const cell = row[x + 1] ?? "";
      const value = toNumber(cell);
      data.push([x, y, value]);
      if (value !== null) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  return {
    grid: { left: 80, right: 32, top: 32, bottom: 60, containLabel: true },
    tooltip: { position: "top" },
    xAxis: { type: "category", data: xLabels, splitArea: { show: true } },
    yAxis: { type: "category", data: yLabels, splitArea: { show: true } },
    visualMap: {
      min,
      max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
    },
    series: [
      {
        type: "heatmap",
        data,
        name: "value",
        label: { show: false },
      },
    ],
  };
}

export function buildChartOption(spec: ChartSpec): EChartsOption {
  switch (spec.type) {
    case "bar":
      return buildBarOption(spec);
    case "line":
      return buildLineOption(spec);
    case "scatter":
      return buildScatterOption(spec);
    case "heatmap":
      return buildHeatmapOption(spec);
  }
}

export const CHART_TYPES: readonly ChartType[] = ["bar", "heatmap", "line", "scatter"];

export function isChartType(value: string): value is ChartType {
  return (CHART_TYPES as readonly string[]).includes(value);
}

export function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ChartSpec>;
  return (
    typeof candidate.type === "string" &&
    isChartType(candidate.type) &&
    Array.isArray(candidate.headers) &&
    Array.isArray(candidate.rows) &&
    Array.isArray(candidate.freeText) &&
    candidate.rows.every((row) => Array.isArray(row))
  );
}
