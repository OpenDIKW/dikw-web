import { describe, expect, it } from "vitest";
import {
  buildBarOption,
  buildHeatmapOption,
  buildLineOption,
  buildScatterOption,
  parseChartFromDetails,
  type ChartSpec,
} from "./chart-spec";

describe("parseChartFromDetails", () => {
  it("extracts a 2-column bar spec from a clean pipe table", () => {
    const body = `| Experimental runs | Acidic Variants (%) |
| ----------------- | -------------------- |
| Ctrl              | 17                   |
| Innovator         | 25                   |`;
    const spec = parseChartFromDetails(body, "bar");
    expect(spec).not.toBeNull();
    expect(spec!.type).toBe("bar");
    expect(spec!.headers).toEqual(["Experimental runs", "Acidic Variants (%)"]);
    expect(spec!.rows).toEqual([
      ["Ctrl", "17"],
      ["Innovator", "25"],
    ]);
    expect(spec!.freeText).toEqual([]);
  });

  it("drops the alignment row with colons", () => {
    const body = `Basic Variants
| Experimental runs | Balsc Variants (%) |
| :--- | :--- |
| Ctrl | 12.8 |
| Innovator | 11.5 |
p<=0.05`;
    const spec = parseChartFromDetails(body, "bar");
    expect(spec).not.toBeNull();
    expect(spec!.headers).toEqual(["Experimental runs", "Balsc Variants (%)"]);
    expect(spec!.rows).toEqual([
      ["Ctrl", "12.8"],
      ["Innovator", "11.5"],
    ]);
    expect(spec!.freeText).toEqual(["Basic Variants", "p<=0.05"]);
  });

  it("returns null when there is no pipe table at all", () => {
    expect(parseChartFromDetails("Just prose. No table here.", "bar")).toBeNull();
  });

  it("returns null when the table has only a header (no data rows)", () => {
    const body = `| A | B |
| --- | --- |`;
    expect(parseChartFromDetails(body, "bar")).toBeNull();
  });

  it("accepts a single-dash alignment row (markdown-it grammar)", () => {
    const body = `| Run | Acid |
| - | - |
| Ctrl | 17 |
| Innovator | 25 |`;
    const spec = parseChartFromDetails(body, "bar");
    expect(spec).not.toBeNull();
    expect(spec!.rows).toEqual([
      ["Ctrl", "17"],
      ["Innovator", "25"],
    ]);
  });

  it("accepts a pipe table without outer pipes", () => {
    const body = `Run | Acid
--- | ---
Ctrl | 17
Innovator | 25`;
    const spec = parseChartFromDetails(body, "bar");
    expect(spec).not.toBeNull();
    expect(spec!.headers).toEqual(["Run", "Acid"]);
    expect(spec!.rows).toEqual([
      ["Ctrl", "17"],
      ["Innovator", "25"],
    ]);
  });

  it("preserves square heatmap matrices", () => {
    const body = `| | Cu | Fe | Zn |
| --- | --- | --- | --- |
| Cu | 1.00 | 0.00 | 0.00 |
| Fe | 0.00 | 1.00 | -0.00 |
| Zn | 0.00 | -0.00 | 1.00 |`;
    const spec = parseChartFromDetails(body, "heatmap");
    expect(spec).not.toBeNull();
    expect(spec!.type).toBe("heatmap");
    expect(spec!.headers).toEqual(["", "Cu", "Fe", "Zn"]);
    expect(spec!.rows).toHaveLength(3);
    expect(spec!.rows[0]).toEqual(["Cu", "1.00", "0.00", "0.00"]);
  });
});

describe("numeric coercion", () => {
  it("extracts the leading number from annotated cells", () => {
    const spec = parseChartFromDetails(
      "| Run | Value |\n| --- | --- |\n| Ctrl | 17 ± 2 |\n| Innovator | -3.5 |",
      "bar",
    );
    const opt = buildBarOption(spec!);
    const series = (opt.series as Array<{ data: Array<number | null> }>)[0];
    expect(series.data).toEqual([17, -3.5]);
  });

  it("emits null for non-numeric and empty cells", () => {
    const spec = parseChartFromDetails(
      "| Run | Value |\n| --- | --- |\n| Ctrl | N/A |\n| Innovator |   |",
      "bar",
    );
    const opt = buildBarOption(spec!);
    const series = (opt.series as Array<{ data: Array<number | null> }>)[0];
    expect(series.data).toEqual([null, null]);
  });

  it("parses scientific notation", () => {
    const spec = parseChartFromDetails("| X | Y |\n| --- | --- |\n| 1 | 1.5e2 |", "bar");
    const opt = buildBarOption(spec!);
    const series = (opt.series as Array<{ data: Array<number | null> }>)[0];
    expect(series.data).toEqual([150]);
  });
});

describe("chart option builders", () => {
  const barSpec: ChartSpec = {
    type: "bar",
    headers: ["Run", "Acid"],
    rows: [
      ["Ctrl", "17"],
      ["Innovator", "25"],
    ],
    freeText: [],
  };

  it("buildBarOption emits a bar series with category x-axis and numeric values", () => {
    const opt = buildBarOption(barSpec);
    expect(opt.series).toHaveLength(1);
    const series = (opt.series as Array<{ type: string; data: number[] }>)[0];
    expect(series.type).toBe("bar");
    expect(series.data).toEqual([17, 25]);
    const xAxis = opt.xAxis as { type: string; data: string[] };
    expect(xAxis.type).toBe("category");
    expect(xAxis.data).toEqual(["Ctrl", "Innovator"]);
  });

  it("buildLineOption emits a line series", () => {
    const opt = buildLineOption({ ...barSpec, type: "line" });
    const series = (opt.series as Array<{ type: string; data: number[] }>)[0];
    expect(series.type).toBe("line");
    expect(series.data).toEqual([17, 25]);
  });

  it("buildScatterOption emits a scatter series with numeric pairs", () => {
    const opt = buildScatterOption({
      type: "scatter",
      headers: ["X", "Y"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
      freeText: [],
    });
    const series = (opt.series as Array<{ type: string; data: number[][] }>)[0];
    expect(series.type).toBe("scatter");
    expect(series.data).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("buildHeatmapOption emits a heatmap with visualMap and matrix triples", () => {
    const opt = buildHeatmapOption({
      type: "heatmap",
      headers: ["", "Cu", "Fe"],
      rows: [
        ["Cu", "1.00", "0.00"],
        ["Fe", "0.00", "1.00"],
      ],
      freeText: [],
    });
    expect(opt.visualMap).toBeDefined();
    const series = (
      opt.series as Array<{ type: string; data: Array<[number, number, number]> }>
    )[0];
    expect(series.type).toBe("heatmap");
    expect(series.data).toContainEqual([0, 0, 1]);
    expect(series.data).toContainEqual([1, 1, 1]);
    expect(series.data).toContainEqual([1, 0, 0]);
    const xAxis = opt.xAxis as { type: string; data: string[] };
    const yAxis = opt.yAxis as { type: string; data: string[] };
    expect(xAxis.data).toEqual(["Cu", "Fe"]);
    expect(yAxis.data).toEqual(["Cu", "Fe"]);
  });
});
