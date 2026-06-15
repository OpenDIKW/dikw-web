// Pipeline state for the Import page. Persisted in **sessionStorage** so a
// page refresh while a task is running can pick up polling where it left off,
// while staying per-tab — a running import belongs to the tab that started it,
// not to every tab. It's tagged with the ``coreUrl`` it belongs to so a
// Settings change to the connection (or a new tab against a different core)
// can't resume a stale task id against the wrong server; that ``coreUrl`` tag
// — not a shared storage scope — is the guard (the connection itself lives in
// ``localStorage``, which is cross-tab).
//
// Upload itself is a single POST — if the user refreshes mid-upload we can't
// recover the request, so we reset to ``idle`` on next mount.

import type { ApplyReport, FixProposal, ImportResponse } from "../types";

export type PipelineStage =
  | "idle"
  /** Browser is calling the sidecar's /web/mineru/convert for one or more
   *  non-markdown sources (PDF / Office formats). Like ``uploading`` this
   *  stage is non-resumable across refresh — mineru's data_id cache plus
   *  the browser's IndexedDB cache make a re-run cheap, so we don't need
   *  to persist the in-flight batch id. */
  | "converting"
  | "uploading"
  | "ingest"
  | "synth"
  | "lint-propose"
  | "lint-review"
  | "lint-apply"
  | "done"
  | "failed"
  | "cancelled";

export interface ConversionFileState {
  inputSha: string;
  fileName: string;
  sizeBytes: number;
  ext: string;
  substage: "queued" | "hashing" | "uploading" | "polling" | "downloading" | "done" | "failed";
  /** Epoch ms when this file started processing (left the ``queued`` state).
   *  Drives the per-row elapsed timer in ConversionProgress. In-memory only —
   *  the ``converting`` stage is never persisted (see savePipelineState). */
  startedAt?: number;
  error?: { code: string; message: string };
}

export interface ConversionState {
  files: Record<string, ConversionFileState>;
  /** Display order — matches the order of files the user dropped. Keys
   *  refer to ConversionFileState entries by ``inputSha``. */
  inputOrder: string[];
}

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
  /** Snapshot of in-flight conversions for the ``converting`` stage. The
   *  state is purely informational (drives the per-file progress UI) and
   *  is intentionally NOT persisted — see savePipelineState. */
  conversion?: ConversionState;
}

export const PIPELINE_STORAGE_KEY = "dikw-web.importPipeline";

const TASK_STAGES: ReadonlySet<PipelineStage> = new Set([
  "ingest",
  "synth",
  "lint-propose",
  "lint-apply",
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
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    return initialState();
  }
  // ``JSON.parse('null')`` is valid JSON returning the value ``null``; without
  // this guard the subsequent ``parsed.coreUrl`` access throws and the page
  // can't even mount. Any non-object value is unrecoverable — fall back to idle.
  if (parsedUnknown === null || typeof parsedUnknown !== "object") {
    return initialState();
  }
  const parsed = parsedUnknown as PipelineState;
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
  // Conversion (mineru round-trips) is also non-resumable in v1 — the
  // browser-side mineru-convert call hung with the page. Rerunning is
  // cheap because mineru caches by data_id, but the state isn't useful
  // to keep around.
  if (parsed.stage === "converting") {
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

export function savePipelineState(state: PipelineState, currentCoreUrl: string): void {
  if (typeof sessionStorage === "undefined") return;
  // ``uploading`` is intentionally not persisted — we'd just have to wipe it
  // on the next mount. Keeping the previous persisted state intact (if any)
  // is the wrong move because the upload may already have started touching
  // the server; the truthful state in storage is "no active pipeline".
  if (state.stage === "uploading" || state.stage === "converting") {
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
    JSON.stringify({ ...state, coreUrl: state.coreUrl ?? currentCoreUrl }),
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
