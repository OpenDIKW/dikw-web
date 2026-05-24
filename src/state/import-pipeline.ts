// Pipeline state for the Import page. Persisted in localStorage so a page
// refresh while a task is running can pick up polling where it left off.
// Upload itself is a single POST — if the user refreshes mid-upload we
// can't recover the request, so we reset to ``idle`` on next mount.

import type {
  ApplyReport,
  FixProposal,
  ImportResponse
} from "../types";

export type PipelineStage =
  | "idle"
  | "uploading"
  | "ingest"
  | "synth"
  | "lint-propose"
  | "lint-review"
  | "lint-apply"
  | "done"
  | "failed"
  | "cancelled";

export interface PipelineError {
  stage: PipelineStage;
  message: string;
  code?: string;
}

export interface PipelineState {
  stage: PipelineStage;
  ingestTaskId?: string;
  synthTaskId?: string;
  lintProposeTaskId?: string;
  lintApplyTaskId?: string;
  importResult?: ImportResponse;
  proposals?: FixProposal[];
  /** Per-proposal indices the user picked to apply, set at the lint-review gate. */
  picked?: number[];
  applyReport?: ApplyReport;
  error?: PipelineError;
}

export const PIPELINE_STORAGE_KEY = "dikw-web.importPipeline";

const TASK_STAGES: ReadonlySet<PipelineStage> = new Set([
  "ingest",
  "synth",
  "lint-propose",
  "lint-apply"
]);

export function initialState(): PipelineState {
  return { stage: "idle" };
}

export function isTaskStage(stage: PipelineStage): boolean {
  return TASK_STAGES.has(stage);
}

export function loadPipelineState(): PipelineState {
  if (typeof localStorage === "undefined") return initialState();
  const raw = localStorage.getItem(PIPELINE_STORAGE_KEY);
  if (!raw) return initialState();
  let parsed: PipelineState;
  try {
    parsed = JSON.parse(raw) as PipelineState;
  } catch {
    return initialState();
  }
  // Upload state can't be recovered — the in-flight POST died with the page.
  if (parsed.stage === "uploading") {
    return initialState();
  }
  // A task stage without its task id is unrecoverable — treat as idle.
  if (parsed.stage === "ingest" && !parsed.ingestTaskId) return initialState();
  if (parsed.stage === "synth" && !parsed.synthTaskId) return initialState();
  if (parsed.stage === "lint-propose" && !parsed.lintProposeTaskId) return initialState();
  if (parsed.stage === "lint-apply" && !parsed.lintApplyTaskId) return initialState();
  // Review stage requires proposals + the source propose task id.
  if (parsed.stage === "lint-review") {
    if (!parsed.proposals || !parsed.lintProposeTaskId) return initialState();
  }
  return parsed;
}

export function savePipelineState(state: PipelineState): void {
  if (typeof localStorage === "undefined") return;
  // ``uploading`` is intentionally not persisted — we'd just have to wipe it
  // on the next mount. Keeping the previous persisted state intact (if any)
  // is the wrong move because the upload may already have started touching
  // the server; the truthful state in storage is "no active pipeline".
  if (state.stage === "uploading") {
    localStorage.removeItem(PIPELINE_STORAGE_KEY);
    return;
  }
  if (state.stage === "idle") {
    localStorage.removeItem(PIPELINE_STORAGE_KEY);
    return;
  }
  localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(state));
}

export function clearPipelineState(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PIPELINE_STORAGE_KEY);
}

/** Identify the currently-running task id (if any) so the page can resume
 *  polling on mount. */
export function activeTaskId(state: PipelineState): string | null {
  switch (state.stage) {
    case "ingest":
      return state.ingestTaskId ?? null;
    case "synth":
      return state.synthTaskId ?? null;
    case "lint-propose":
      return state.lintProposeTaskId ?? null;
    case "lint-apply":
      return state.lintApplyTaskId ?? null;
    default:
      return null;
  }
}
