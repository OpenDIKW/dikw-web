import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { PipelineStage } from "../../state/import-pipeline";
import type { TaskEvent } from "../../types";
import { formatBytes, formatElapsed, stageRank, stepMeta, STEPS, type ImportCopy } from "./format";

interface PipelineStepsProps {
  copy: ImportCopy;
  stage: PipelineStage;
  activeEvent: TaskEvent | null;
  wasResumed: boolean;
  startedAt: number | null;
  importResult: {
    committed: number[];
    rejected: unknown[];
    bytes: number;
  } | null;
  ingestTaskId?: string;
  synthTaskId?: string;
  lintProposeTaskId?: string;
  lintApplyTaskId?: string;
}

export function PipelineSteps({
  copy,
  stage,
  activeEvent,
  wasResumed,
  startedAt,
  importResult,
  ingestTaskId,
  synthTaskId,
  lintProposeTaskId,
  lintApplyTaskId,
}: PipelineStepsProps) {
  const currentRank = stageRank(stage);
  const stepNumber = useMemo(() => {
    const idx = STEPS.findIndex((s) => s.id === stage);
    return idx < 0 ? STEPS.length : idx + 1;
  }, [stage]);

  // Tick a clock every second so the elapsed string advances even when no
  // TaskEvent is firing — long uploads / synth stages can sit silent for
  // minutes and a frozen `0s` reads as a broken page.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const progress = activeEvent && activeEvent.type === "progress" ? activeEvent : null;
  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;

  const activeTaskIdForStage = (() => {
    switch (stage) {
      case "ingest":
        return ingestTaskId;
      case "synth":
        return synthTaskId;
      case "lint-propose":
        return lintProposeTaskId;
      case "lint-apply":
        return lintApplyTaskId;
      default:
        return undefined;
    }
  })();
  const activeStep = STEPS.find((s) => s.id === stage);
  const activeStageDesc = activeStep ? copy.stageDescriptions[activeStep.labelKey] : "";

  return (
    <>
      {wasResumed ? (
        <div className="import-resume-banner" role="status" data-testid="import-resume-banner">
          <span className="import-resume-banner__icon" aria-hidden="true">
            <RefreshCw size={16} />
          </span>
          <div className="import-resume-banner__body">
            <div className="import-resume-banner__title">{copy.resumeBannerTitle}</div>
            <div className="import-resume-banner__detail">{copy.resumeBannerBody}</div>
          </div>
          {activeTaskIdForStage ? (
            <code className="import-resume-banner__task-id">{activeTaskIdForStage}</code>
          ) : null}
        </div>
      ) : null}

      <section className="panel" data-testid="import-pipeline">
        <div className="import-pipeline-head">
          <div>
            <div className="import-pipeline-head__title">{copy.pipelineTitle}</div>
            <div className="import-pipeline-head__hint">
              {copy.pipelineStepOf
                .replace("{n}", String(stepNumber))
                .replace("{total}", String(STEPS.length))}
              {startedAt ? ` · ${formatElapsed(now - startedAt)}` : ""}
              {" · "}
              {copy.pipelineResumable}
            </div>
          </div>
          <span className="import-pipeline-running-pill">
            <span className="import-dot-pulse" aria-hidden="true" />
            {copy.pipelineRunning}
          </span>
        </div>

        <div className="import-stepper">
          {STEPS.map((step, i) => {
            const rank = stageRank(step.id);
            const status =
              rank < currentRank ? "done" : rank === currentRank ? "running" : "pending";
            const label = copy.stages[step.labelKey];
            const fill = status === "done" ? 100 : status === "running" ? (pct ?? null) : 0;
            const indeterminate = status === "running" && pct == null;
            const meta = stepMeta(step.id, status, progress, importResult, copy);
            return (
              <div className={`import-step import-step--${status}`} key={step.id}>
                <div className="import-step__head">
                  <span className="import-step__marker" aria-hidden="true">
                    {status === "done" ? (
                      <Check size={11} />
                    ) : status === "running" ? (
                      <span className="import-dot-pulse" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="import-step__label" title={label}>
                    {label}
                  </span>
                </div>
                <div
                  className={`import-step__bar${
                    indeterminate ? " import-step__bar--indeterminate" : ""
                  }`}
                >
                  <div
                    className="import-step__bar-fill"
                    style={indeterminate ? undefined : { width: `${fill ?? 0}%` }}
                  />
                </div>
                <div className="import-step__meta">{meta}</div>
              </div>
            );
          })}
        </div>

        <div className="import-active-stage">
          <div className="import-active-stage__head">
            <div className="import-active-stage__head-left">
              <span className="import-dot-pulse" aria-hidden="true" />
              <span className="import-active-stage__desc">{activeStageDesc}</span>
            </div>
            {/* Skip the task id here when the resume banner already shows it
                — duplicate text breaks getByText queries in tests and is
                redundant for the user. */}
            {activeTaskIdForStage && !wasResumed ? (
              <code className="import-active-stage__task-id">{activeTaskIdForStage}</code>
            ) : null}
          </div>
          <div className="import-active-stage__body">
            {progress ? (
              <>
                <div className="import-active-stage__progress-row">
                  <span>
                    <span className="import-active-stage__progress-row-label">
                      {copy.pipelinePhaseLabel}
                    </span>{" "}
                    · {progress.phase}
                  </span>
                  <span className="import-active-stage__progress-row-value">
                    {progress.current} / {progress.total}
                    {pct != null ? ` · ${pct}%` : ""}
                  </span>
                </div>
                <div
                  className={`import-active-stage__bar${
                    pct == null ? " import-active-stage__bar--indeterminate" : ""
                  }`}
                >
                  <div
                    className="import-active-stage__bar-fill"
                    style={pct == null ? undefined : { width: `${pct}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="import-active-stage__placeholder">
                {activeEvent && activeEvent.type === "log"
                  ? activeEvent.message
                  : copy.pipelineLeaveHint}
              </div>
            )}
          </div>
        </div>

        {importResult ? (
          <div className="import-completed-row import-completed-row--spaced">
            <span className="import-pill import-pill--green">
              <Check size={11} />
              {copy.stages.uploading} · {formatBytes(importResult.bytes)}
            </span>
            {importResult.committed.length > 0 ? (
              <span className="import-pill import-pill--green">
                <Check size={11} />
                {copy.stages.ingest} · {importResult.committed.length} {copy.previewPackagesShort}
              </span>
            ) : null}
            {importResult.rejected.length > 0 ? (
              <span className="import-pill import-pill--amber">
                {importResult.rejected.length} {copy.summaryRejected}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
