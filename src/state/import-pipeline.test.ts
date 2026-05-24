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

const CORE = "http://core.test";

afterEach(() => {
  sessionStorage.clear();
});

describe("pipeline persistence", () => {
  it("returns initial state when nothing is stored", () => {
    expect(loadPipelineState(CORE)).toEqual({ stage: "idle" });
  });

  it("round-trips a task-stage state and stamps the coreUrl", () => {
    savePipelineState({ stage: "ingest", ingestTaskId: "t-1" }, CORE);
    expect(loadPipelineState(CORE)).toEqual({
      stage: "ingest",
      ingestTaskId: "t-1",
      coreUrl: CORE
    });
  });

  it("discards persisted state belonging to a different core", () => {
    savePipelineState({ stage: "ingest", ingestTaskId: "t-1" }, CORE);
    // User changed Settings to a different server URL — the task ids belong
    // to the old core and must not be replayed against the new one.
    expect(loadPipelineState("http://other.core")).toEqual({ stage: "idle" });
  });

  it("save refuses to overwrite an existing coreUrl tag with a different current core", () => {
    // The in-memory state already carries coreUrl=A from startPipeline. If
    // the user changes Settings mid-pipeline (currentCoreUrl=B), the save
    // effect must NOT rewrite the tag — otherwise loadPipelineState's
    // cross-core guard sees coreUrl=B on next mount and replays A's task ids
    // against B.
    savePipelineState(
      { stage: "ingest", ingestTaskId: "t-1", coreUrl: CORE },
      "http://other.core"
    );
    const raw = sessionStorage.getItem(PIPELINE_STORAGE_KEY);
    // Storage either retained the original (no overwrite) or stayed empty —
    // never gets the wrong stamp.
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.coreUrl).toBe(CORE);
    }
  });

  it("clears storage on idle save", () => {
    sessionStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify({ stage: "ingest", ingestTaskId: "t-x" }));
    savePipelineState({ stage: "idle" }, CORE);
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });

  it("treats persisted uploading state as a dead transaction (back to idle)", () => {
    sessionStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "uploading", coreUrl: CORE })
    );
    expect(loadPipelineState(CORE)).toEqual({ stage: "idle" });
  });

  it("treats a task stage without its task id as unrecoverable", () => {
    sessionStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "synth", coreUrl: CORE })
    );
    expect(loadPipelineState(CORE)).toEqual({ stage: "idle" });
  });

  it("ignores corrupt JSON in storage", () => {
    sessionStorage.setItem(PIPELINE_STORAGE_KEY, "not-json");
    expect(loadPipelineState(CORE)).toEqual({ stage: "idle" });
  });

  it("treats lint-review without proposals as unrecoverable", () => {
    sessionStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "lint-review", lintProposeTaskId: "p-1", coreUrl: CORE })
    );
    expect(loadPipelineState(CORE)).toEqual({ stage: "idle" });
  });

  it("clearPipelineState wipes storage", () => {
    savePipelineState({ stage: "ingest", ingestTaskId: "t-1" }, CORE);
    clearPipelineState();
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });

  it("never writes the uploading stage to disk", () => {
    savePipelineState({ stage: "uploading" }, CORE);
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
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
