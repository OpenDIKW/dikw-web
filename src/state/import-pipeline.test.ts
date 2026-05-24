import { afterEach, describe, expect, it } from "vitest";
import {
  PIPELINE_STORAGE_KEY,
  activeTaskId,
  clearPipelineState,
  initialState,
  isTaskStage,
  loadPipelineState,
  savePipelineState
} from "./import-pipeline";

afterEach(() => {
  localStorage.clear();
});

describe("pipeline persistence", () => {
  it("returns initial state when nothing is stored", () => {
    expect(loadPipelineState()).toEqual({ stage: "idle" });
  });

  it("round-trips a task-stage state", () => {
    savePipelineState({ stage: "ingest", ingestTaskId: "t-1" });
    expect(loadPipelineState()).toEqual({ stage: "ingest", ingestTaskId: "t-1" });
  });

  it("clears storage on idle save", () => {
    localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify({ stage: "ingest", ingestTaskId: "t-x" }));
    savePipelineState({ stage: "idle" });
    expect(localStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });

  it("treats persisted uploading state as a dead transaction (back to idle)", () => {
    localStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "uploading" })
    );
    expect(loadPipelineState()).toEqual({ stage: "idle" });
  });

  it("treats a task stage without its task id as unrecoverable", () => {
    localStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "synth" })
    );
    expect(loadPipelineState()).toEqual({ stage: "idle" });
  });

  it("ignores corrupt JSON in storage", () => {
    localStorage.setItem(PIPELINE_STORAGE_KEY, "not-json");
    expect(loadPipelineState()).toEqual({ stage: "idle" });
  });

  it("treats lint-review without proposals as unrecoverable", () => {
    localStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "lint-review", lintProposeTaskId: "p-1" })
    );
    expect(loadPipelineState()).toEqual({ stage: "idle" });
  });

  it("clearPipelineState wipes storage", () => {
    savePipelineState({ stage: "ingest", ingestTaskId: "t-1" });
    clearPipelineState();
    expect(localStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });

  it("never writes the uploading stage to disk", () => {
    savePipelineState({ stage: "uploading" });
    expect(localStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });
});

describe("activeTaskId / isTaskStage", () => {
  it("returns the running task id for each task stage", () => {
    expect(
      activeTaskId({ stage: "ingest", ingestTaskId: "i-1" })
    ).toBe("i-1");
    expect(
      activeTaskId({ stage: "synth", synthTaskId: "s-1" })
    ).toBe("s-1");
    expect(
      activeTaskId({ stage: "lint-propose", lintProposeTaskId: "lp-1" })
    ).toBe("lp-1");
    expect(
      activeTaskId({ stage: "lint-apply", lintApplyTaskId: "la-1" })
    ).toBe("la-1");
  });

  it("returns null for non-task stages", () => {
    expect(activeTaskId(initialState())).toBeNull();
    expect(
      activeTaskId({
        stage: "lint-review",
        lintProposeTaskId: "p",
        proposals: []
      })
    ).toBeNull();
    expect(activeTaskId({ stage: "done" })).toBeNull();
  });

  it("flags only async-task stages", () => {
    expect(isTaskStage("ingest")).toBe(true);
    expect(isTaskStage("lint-apply")).toBe(true);
    expect(isTaskStage("uploading")).toBe(false);
    expect(isTaskStage("lint-review")).toBe(false);
    expect(isTaskStage("done")).toBe(false);
  });
});
