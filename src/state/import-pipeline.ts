// Pipeline state for the Import page. Persisted in **sessionStorage** so a
// page refresh while a task is running can pick up polling where it left off
// — and tagged with the ``coreUrl`` it belongs to so a Settings change to
// the connection (or a new tab against a different core) can't resume a stale
// task id against the wrong server. sessionStorage matches the scope of the
// connection itself (``dikw-web.serverUrl`` / ``dikw-web.token`` also live
// there), so the two die together when the tab closes.
//
// Upload itself is a single POST — if the user refreshes mid-upload we can't
// recover the request, so we reset to ``idle`` on next mount.

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
  /** The core URL this pipeline is bound to. Set automatically when persisted
   *  via ``savePipelineState``; checked in ``loadPipelineState`` to discard
   *  state that belongs to a different server. */
  coreUrl?: string;
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

export function loadPipelineState(currentCoreUrl: string): PipelineState {
  if (typeof sessionStorage === "undefined") return initialState();
  const raw = sessionStorage.getItem(PIPELINE_STORAGE_KEY);
  if (!raw) return initialState();
  let parsed: PipelineState;
  try {
    parsed = JSON.parse(raw) as PipelineState;
  } catch {
    return initialState();
  }
  // Connection mismatch — the persisted task ids belong to a different core.
  // Polling / cancelling / applying against the current client could touch
  // the wrong server. Discard rather than risk a cross-core write.
  if (parsed.coreUrl && parsed.coreUrl !== currentCoreUrl) {
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

export function savePipelineState(
  state: PipelineState,
  currentCoreUrl: string
): void {
  if (typeof sessionStorage === "undefined") return;
  // ``uploading`` is intentionally not persisted — we'd just have to wipe it
  // on the next mount. Keeping the previous persisted state intact (if any)
  // is the wrong move because the upload may already have started touching
  // the server; the truthful state in storage is "no active pipeline".
  if (state.stage === "uploading") {
    sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
    return;
  }
  if (state.stage === "idle") {
    sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
    return;
  }
  // Defense against the cross-core rebind: if the state already carries a
  // coreUrl tag from an earlier core, refuse to overwrite it with a fresh
  // currentCoreUrl. The task ids belong to the original core; rewriting the
  // tag would let loadPipelineState happily resume them against the new
  // server. Instead, drop persistence entirely — the original state is
  // already in storage and will be discarded by loadPipelineState's
  // cross-core guard on next mount.
  if (state.coreUrl && state.coreUrl !== currentCoreUrl) {
    return;
  }
  sessionStorage.setItem(
    PIPELINE_STORAGE_KEY,
    JSON.stringify({ ...state, coreUrl: state.coreUrl ?? currentCoreUrl })
  );
}

export function clearPipelineState(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
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
