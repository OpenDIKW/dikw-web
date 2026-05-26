// Helpers and constants shared by the Import page subviews. Kept React-free
// so the lint-tone / stage-rank / formatter logic can be tested in isolation.

import { translations } from "../../i18n";
import type { LintKind, TaskEvent } from "../../types";
import type { PipelineStage } from "../../state/import-pipeline";
import type { SkippedFile } from "../../utils/import-bundle";

export type ImportCopy = (typeof translations)["en"]["pages"]["import"];

export type RunStage =
  | "uploading"
  | "ingest"
  | "synth"
  | "lint-propose"
  | "lint-apply";

export interface PipelineStepView {
  id: RunStage;
  labelKey: keyof ImportCopy["stages"];
}

export const STEPS: PipelineStepView[] = [
  { id: "uploading", labelKey: "uploading" },
  { id: "ingest", labelKey: "ingest" },
  { id: "synth", labelKey: "synth" },
  { id: "lint-propose", labelKey: "lintPropose" },
  { id: "lint-apply", labelKey: "lintApply" }
];

const ALL_STAGES_ORDER: PipelineStage[] = [
  "idle",
  "converting",
  "uploading",
  "ingest",
  "synth",
  "lint-propose",
  "lint-review",
  "lint-apply",
  "done"
];

export function stageRank(stage: PipelineStage): number {
  const idx = ALL_STAGES_ORDER.indexOf(stage);
  return idx < 0 ? 0 : idx;
}

export function isRunningStage(stage: PipelineStage): boolean {
  return (
    stage === "uploading" ||
    stage === "ingest" ||
    stage === "synth" ||
    stage === "lint-propose" ||
    stage === "lint-apply"
  );
}

export function stepMeta(
  stepId: RunStage,
  status: "done" | "running" | "pending",
  progress: Extract<TaskEvent, { type: "progress" }> | null,
  importResult: { committed: number[]; bytes: number } | null,
  copy: ImportCopy
): string {
  if (status === "done") {
    if (stepId === "uploading" && importResult) {
      return formatBytes(importResult.bytes);
    }
    if (stepId === "ingest" && importResult) {
      return `${importResult.committed.length} ${copy.stepMetaCommitted}`;
    }
    return "";
  }
  if (status === "running" && progress) {
    return progress.phase;
  }
  return "";
}

export function taskErrorMessage(
  final: Extract<TaskEvent, { type: "final" }> | null,
  fallback: string
): string {
  if (!final || !final.error) return fallback;
  const m = final.error.message;
  return typeof m === "string" ? m : fallback;
}

export function skippedTag(copy: ImportCopy, s: SkippedFile): string {
  switch (s.reason) {
    case "unsupported_extension":
      return copy.skippedTagUnsupported;
    case "empty_body":
      return copy.skippedTagEmpty;
    case "asset_missing":
      return copy.skippedTagMissing;
    case "unreferenced_asset":
      return copy.skippedTagUnreferenced;
    case "duplicate_path":
      return copy.skippedTagDuplicate;
    case "path_too_long":
      return copy.skippedTagTooLong;
  }
}

export function lintKindTone(kind: LintKind): "amber" | "red" | "muted" {
  switch (kind) {
    case "broken_wikilink":
      return "red";
    case "duplicate_title":
    case "orphan_page":
    case "missing_provenance":
      return "amber";
    case "non_atomic_page":
      return "muted";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, "0")}s`;
}

/** Thrown by the orchestrator when a pipeline stage finishes in a non-success
 *  state — carries the failed stage so the error UI can render it accurately
 *  (otherwise we'd attribute every failure to the *current* stage, which is
 *  one step ahead by the time we throw). */
export class PipelineFailure extends Error {
  readonly failedStage: PipelineStage;
  constructor(failedStage: PipelineStage, message: string) {
    super(message);
    this.name = "PipelineFailure";
    this.failedStage = failedStage;
  }
}
