import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLogLine, formatLogLine } from "./loop-log.mjs";

describe("formatLogLine", () => {
  it("emits a single-line JSON object with ts/event/detail", () => {
    const line = formatLogLine({ ts: 1700000000000, event: "green", detail: "done in 3" });
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ ts: 1700000000000, event: "green", detail: "done in 3" });
  });

  it("keeps a multi-line detail on one line (escaped)", () => {
    const line = formatLogLine({ ts: 1, event: "fixer", detail: "line1\nline2" });
    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line).detail).toBe("line1\nline2");
  });

  it("defaults a missing detail to an empty string", () => {
    expect(JSON.parse(formatLogLine({ ts: 1, event: "iter_start" })).detail).toBe("");
  });
});

describe("appendLogLine", () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "looplog-"));
    file = join(dir, ".loop-log.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends one JSONL line per call", () => {
    appendLogLine(file, { ts: 1, event: "iter_start", detail: "" });
    appendLogLine(file, { ts: 2, event: "green", detail: "done" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe("iter_start");
    expect(JSON.parse(lines[1])).toEqual({ ts: 2, event: "green", detail: "done" });
  });
});
