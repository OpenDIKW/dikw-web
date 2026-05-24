import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Pause,
  Play,
  Upload,
  XCircle
} from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { translations, type Locale } from "../i18n";
import {
  buildImportBundle,
  ImportBundleError,
  type ImportBundleResult,
  type SkippedFile
} from "../utils/import-bundle";
import {
  activeTaskId,
  clearPipelineState,
  initialState,
  loadPipelineState,
  savePipelineState,
  type PipelineStage,
  type PipelineState
} from "../state/import-pipeline";
import type {
  ApplyReport,
  FixProposal,
  FixProposalReport,
  TaskEvent
} from "../types";

interface ImportPageProps {
  client: DikwClient;
  locale?: Locale;
}

interface PipelineStepView {
  id: Exclude<PipelineStage, "idle" | "lint-review" | "done" | "failed" | "cancelled">;
  labelKey: keyof (typeof translations)["en"]["pages"]["import"]["stages"];
}

const STEPS: PipelineStepView[] = [
  { id: "uploading", labelKey: "uploading" },
  { id: "ingest", labelKey: "ingest" },
  { id: "synth", labelKey: "synth" },
  { id: "lint-propose", labelKey: "lintPropose" },
  { id: "lint-apply", labelKey: "lintApply" }
];

const ALL_STAGES_ORDER: PipelineStage[] = [
  "idle",
  "uploading",
  "ingest",
  "synth",
  "lint-propose",
  "lint-review",
  "lint-apply",
  "done"
];

function stageRank(stage: PipelineStage): number {
  const idx = ALL_STAGES_ORDER.indexOf(stage);
  return idx < 0 ? 0 : idx;
}

export function ImportPage({ client, locale = "en" }: ImportPageProps) {
  const copy = translations[locale].pages.import;
  const coreId = client.coreId;
  // Lazy-init from storage so a refresh during a task stage doesn't lose the
  // persisted task id. If we initialized with ``initialState()`` then saved on
  // the next effect tick, the save would clear storage before the resume
  // effect could read it — see codex review of f927a79. State is bound to the
  // current ``coreId`` so a Settings change can't resume against the wrong core.
  const [pipeline, setPipeline] = useState<PipelineState>(() =>
    loadPipelineState(coreId)
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [bundle, setBundle] = useState<ImportBundleResult | null>(null);
  const [bundleError, setBundleError] = useState<unknown>(null);
  const [bundleBuilding, setBundleBuilding] = useState(false);
  const [activeEvent, setActiveEvent] = useState<TaskEvent | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Generation counter so a slow ``buildImportBundle`` from an earlier
  // selection can't overwrite a fresher one that finished first — without
  // this, the preview can momentarily reflect files the user no longer has
  // selected and Start would upload the wrong bytes.
  const bundleGenRef = useRef(0);

  // Persist every pipeline-state change so a refresh during a task stage
  // can resume without losing the task id.
  useEffect(() => {
    savePipelineState(pipeline, coreId);
  }, [pipeline, coreId]);

  // ---- Resume polling on mount when a task is mid-flight -------------------
  const resumeOnMountRef = useRef(false);
  useEffect(() => {
    if (resumeOnMountRef.current) return;
    resumeOnMountRef.current = true;
    if (pipeline.stage === "idle") return;
    if (activeTaskId(pipeline)) {
      const controller = new AbortController();
      controllerRef.current = controller;
      void resumeRunningTask(pipeline, controller);
    }
    // intentionally no deps — only runs once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    []
  );

  // ---- File selection ------------------------------------------------------

  const onFilesChosen = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const gen = ++bundleGenRef.current;
    setSelectedFiles(files);
    setBundle(null);
    setBundleError(null);
    setBundleBuilding(true);
    buildImportBundle(files)
      .then((result) => {
        if (bundleGenRef.current !== gen) return; // superseded
        setBundle(result);
        setBundleBuilding(false);
      })
      .catch((err) => {
        if (bundleGenRef.current !== gen) return;
        setBundleError(err);
        setBundleBuilding(false);
      });
  }, []);

  const resetPicker = useCallback(() => {
    // Bump the gen so any in-flight bundle promise's setState is ignored.
    bundleGenRef.current += 1;
    setSelectedFiles([]);
    setBundle(null);
    setBundleError(null);
    setBundleBuilding(false);
  }, []);

  // ---- Pipeline orchestration ---------------------------------------------

  const consumeTask = useCallback(
    async (taskId: string, signal: AbortSignal) => {
      let final: Extract<TaskEvent, { type: "final" }> | null = null;
      for await (const event of client.streamTaskEvents(taskId, 0, signal)) {
        setActiveEvent(event);
        if (event.type === "final") final = event;
      }
      return final;
    },
    [client]
  );

  const startPipeline = useCallback(async () => {
    if (!bundle) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setActiveEvent(null);
    setPipeline({ stage: "uploading" });
    try {
      const importResult = await client.importBundle(
        bundle.payload,
        bundle.manifestJson,
        controller.signal
      );

      // Ingest
      setPipeline({ stage: "ingest", importResult });
      const ingestHandle = await client.startIngest({}, controller.signal);
      setPipeline((p) => ({ ...p, ingestTaskId: ingestHandle.task_id }));
      const ingestFinal = await consumeTask(
        ingestHandle.task_id,
        controller.signal
      );
      if (ingestFinal?.status !== "succeeded") {
        throw new PipelineFailure(
          "ingest",
          ingestFinal?.status === "cancelled"
            ? "ingest cancelled"
            : taskErrorMessage(ingestFinal, "ingest failed")
        );
      }

      // Synth
      setPipeline((p) => ({ ...p, stage: "synth" }));
      const synthHandle = await client.startSynth({}, controller.signal);
      setPipeline((p) => ({ ...p, synthTaskId: synthHandle.task_id }));
      const synthFinal = await consumeTask(
        synthHandle.task_id,
        controller.signal
      );
      if (synthFinal?.status !== "succeeded") {
        throw new PipelineFailure(
          "synth",
          synthFinal?.status === "cancelled"
            ? "synth cancelled"
            : taskErrorMessage(synthFinal, "synth failed")
        );
      }

      // Lint propose
      setPipeline((p) => ({ ...p, stage: "lint-propose" }));
      const proposeHandle = await client.startLintPropose({}, controller.signal);
      setPipeline((p) => ({ ...p, lintProposeTaskId: proposeHandle.task_id }));
      const proposeFinal = await consumeTask(
        proposeHandle.task_id,
        controller.signal
      );
      if (proposeFinal?.status !== "succeeded") {
        throw new PipelineFailure(
          "lint-propose",
          proposeFinal?.status === "cancelled"
            ? "lint propose cancelled"
            : taskErrorMessage(proposeFinal, "lint propose failed")
        );
      }
      const proposeResult = await client.getTaskResult<FixProposalReport>(
        proposeHandle.task_id,
        controller.signal
      );
      const proposals = proposeResult.proposals ?? [];
      if (proposals.length === 0) {
        // Nothing to fix — pipeline complete.
        setPipeline((p) => ({
          ...p,
          stage: "done",
          proposals: [],
          picked: []
        }));
        return;
      }
      setPipeline((p) => ({
        ...p,
        stage: "lint-review",
        proposals,
        picked: proposals.map((_, i) => i)
      }));
    } catch (err) {
      handlePipelineError(err);
    }
  }, [bundle, client, consumeTask]);

  const applyLint = useCallback(
    async (picked: number[]) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setActiveEvent(null);
      setPipeline((p) => ({ ...p, stage: "lint-apply", picked }));
      try {
        const proposeId = pipeline.lintProposeTaskId;
        if (!proposeId) {
          throw new PipelineFailure(
            "lint-apply",
            "missing propose task id; cannot apply"
          );
        }
        const applyHandle = await client.startLintApply(
          { proposalTaskId: proposeId, pick: picked },
          controller.signal
        );
        setPipeline((p) => ({ ...p, lintApplyTaskId: applyHandle.task_id }));
        const applyFinal = await consumeTask(
          applyHandle.task_id,
          controller.signal
        );
        if (applyFinal?.status === "cancelled") {
          throw new PipelineFailure("lint-apply", "lint apply cancelled");
        }
        // Even if some proposals are server-side-skipped, the task may still
        // SUCCEED — partial fix counts as completion. Only a true task FAILED
        // status drops us into the failed branch.
        if (applyFinal?.status !== "succeeded") {
          throw new PipelineFailure(
            "lint-apply",
            taskErrorMessage(applyFinal, "lint apply failed")
          );
        }
        const applyReport = await client.getTaskResult<ApplyReport>(
          applyHandle.task_id,
          controller.signal
        );
        setPipeline((p) => ({ ...p, stage: "done", applyReport }));
      } catch (err) {
        handlePipelineError(err);
      }
    },
    [client, consumeTask, pipeline.lintProposeTaskId]
  );

  const skipAllLint = useCallback(() => {
    // User reviewed and chose to apply nothing — short-circuit straight to done.
    setPipeline((p) => ({ ...p, stage: "done", picked: [] }));
  }, []);

  const resumeRunningTask = useCallback(
    async (persisted: PipelineState, controller: AbortController) => {
      try {
        const taskId = activeTaskId(persisted);
        if (!taskId) return;
        const final = await consumeTask(taskId, controller.signal);
        if (final?.status === "cancelled") {
          setPipeline((p) => ({
            ...p,
            stage: "cancelled",
            error: { stage: p.stage, message: `${p.stage} cancelled` }
          }));
          return;
        }
        if (final?.status !== "succeeded") {
          setPipeline((p) => ({
            ...p,
            stage: "failed",
            error: {
              stage: p.stage,
              message: taskErrorMessage(final, `${p.stage} failed`)
            }
          }));
          return;
        }
        // Advance to the next stage. We can't easily continue the original
        // pipeline closure across a refresh, so each resumed task is treated
        // independently: kick off the next phase from here.
        if (persisted.stage === "ingest") {
          setPipeline((p) => ({ ...p, stage: "synth" }));
          const synthHandle = await client.startSynth({}, controller.signal);
          setPipeline((p) => ({ ...p, synthTaskId: synthHandle.task_id }));
          const synthFinal = await consumeTask(
            synthHandle.task_id,
            controller.signal
          );
          if (synthFinal?.status !== "succeeded") {
            throw new PipelineFailure(
              "synth",
              taskErrorMessage(synthFinal, "synth failed")
            );
          }
          await continueFromSynth(controller);
        } else if (persisted.stage === "synth") {
          await continueFromSynth(controller);
        } else if (persisted.stage === "lint-propose") {
          await finalizeProposeAndGate(persisted.lintProposeTaskId!, controller);
        } else if (persisted.stage === "lint-apply") {
          const applyReport = await client.getTaskResult<ApplyReport>(
            persisted.lintApplyTaskId!,
            controller.signal
          );
          setPipeline((p) => ({ ...p, stage: "done", applyReport }));
        }
      } catch (err) {
        handlePipelineError(err);
      }
    },
    [client, consumeTask]
  );

  async function continueFromSynth(controller: AbortController) {
    setPipeline((p) => ({ ...p, stage: "lint-propose" }));
    const proposeHandle = await client.startLintPropose({}, controller.signal);
    setPipeline((p) => ({ ...p, lintProposeTaskId: proposeHandle.task_id }));
    const proposeFinal = await consumeTask(
      proposeHandle.task_id,
      controller.signal
    );
    if (proposeFinal?.status !== "succeeded") {
      throw new PipelineFailure(
        "lint-propose",
        taskErrorMessage(proposeFinal, "lint propose failed")
      );
    }
    await finalizeProposeAndGate(proposeHandle.task_id, controller);
  }

  async function finalizeProposeAndGate(
    proposeTaskId: string,
    controller: AbortController
  ) {
    const proposeResult = await client.getTaskResult<FixProposalReport>(
      proposeTaskId,
      controller.signal
    );
    const proposals = proposeResult.proposals ?? [];
    if (proposals.length === 0) {
      setPipeline((p) => ({ ...p, stage: "done", proposals: [], picked: [] }));
      return;
    }
    setPipeline((p) => ({
      ...p,
      stage: "lint-review",
      proposals,
      picked: proposals.map((_, i) => i)
    }));
  }

  function handlePipelineError(err: unknown) {
    if (controllerRef.current?.signal.aborted) {
      // Cancellation path — pipeline state is set in onCancel.
      return;
    }
    setPipeline((p) => ({
      ...p,
      stage: "failed",
      error: {
        stage: err instanceof PipelineFailure ? err.failedStage : p.stage,
        message:
          err instanceof DikwClientError
            ? err.message
            : err instanceof Error
            ? err.message
            : String(err),
        code: err instanceof DikwClientError ? err.code : undefined
      }
    }));
  }

  const onCancel = useCallback(async () => {
    const controller = controllerRef.current;
    controller?.abort();
    const taskId = activeTaskId(pipeline);
    if (taskId) {
      // Best-effort server cancel; ignore failures (the task may already be done).
      try {
        await client.cancelTask(taskId);
      } catch {
        // swallow
      }
    }
    setPipeline((p) => ({
      ...p,
      stage: "cancelled",
      error: { stage: p.stage, message: `${p.stage} cancelled by user` }
    }));
  }, [client, pipeline]);

  const startOver = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearPipelineState();
    setPipeline(initialState());
    setActiveEvent(null);
    resetPicker();
  }, [resetPicker]);

  // ---- Render branches -----------------------------------------------------

  const stage = pipeline.stage;

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {isRunning(stage) ? (
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
              data-testid="import-cancel"
            >
              <Pause size={16} />
              {copy.cancel}
            </button>
          </div>
        ) : null}
      </header>

      {stage === "idle" ? (
        <IdlePicker
          copy={copy}
          onFilesChosen={onFilesChosen}
          bundle={bundle}
          bundleBuilding={bundleBuilding}
          bundleError={bundleError}
          selectedCount={selectedFiles.length}
          onStart={startPipeline}
          onReset={resetPicker}
        />
      ) : null}

      {isRunning(stage) ? (
        <PipelineSteps
          copy={copy}
          stage={stage}
          activeEvent={activeEvent}
          ingestTaskId={pipeline.ingestTaskId}
          synthTaskId={pipeline.synthTaskId}
          lintProposeTaskId={pipeline.lintProposeTaskId}
          lintApplyTaskId={pipeline.lintApplyTaskId}
        />
      ) : null}

      {stage === "lint-review" && pipeline.proposals ? (
        <LintReview
          copy={copy}
          proposals={pipeline.proposals}
          initialPicked={pipeline.picked ?? []}
          onApply={applyLint}
          onSkipAll={skipAllLint}
        />
      ) : null}

      {stage === "done" ? (
        <DoneSummary
          copy={copy}
          pipeline={pipeline}
          onStartOver={startOver}
        />
      ) : null}

      {(stage === "failed" || stage === "cancelled") && pipeline.error ? (
        <Notice
          title={stage === "failed" ? copy.errorTitle : copy.cancelledTitle}
          tone={stage === "failed" ? "bad" : "warn"}
        >
          <div>{copy.errorStageLabel}: {pipeline.error.stage}</div>
          <div>{pipeline.error.message}</div>
          {pipeline.error.code ? (
            <div className="notice__code">{pipeline.error.code}</div>
          ) : null}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="primary-button"
              onClick={startOver}
            >
              {copy.restart}
            </button>
          </div>
        </Notice>
      ) : null}
    </div>
  );
}

// ---- Subviews -------------------------------------------------------------

interface IdlePickerProps {
  copy: ImportCopy;
  onFilesChosen: (files: File[]) => void;
  bundle: ImportBundleResult | null;
  bundleBuilding: boolean;
  bundleError: unknown;
  selectedCount: number;
  onStart: () => void;
  onReset: () => void;
}

function IdlePicker({
  copy,
  onFilesChosen,
  bundle,
  bundleBuilding,
  bundleError,
  selectedCount,
  onStart,
  onReset
}: IdlePickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <section className="panel">
        <div className="panel__title">{copy.pickerTitle}</div>
        <p>{copy.pickerHint}</p>
        <div className="query-form query-form--compact">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileRef.current?.click()}
          >
            <FileText size={16} />
            {copy.pickFiles}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => folderRef.current?.click()}
          >
            <FolderOpen size={16} />
            {copy.pickFolder}
          </button>
          {selectedCount > 0 ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onReset}
            >
              {copy.clearSelection}
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const list = e.target.files;
            if (!list) return;
            onFilesChosen(Array.from(list));
            e.target.value = "";
          }}
          data-testid="import-file-input"
        />
        <input
          ref={folderRef}
          type="file"
          // @ts-expect-error — webkitdirectory is a non-standard but widely-supported attribute.
          webkitdirectory=""
          directory=""
          style={{ display: "none" }}
          onChange={(e) => {
            const list = e.target.files;
            if (!list) return;
            onFilesChosen(Array.from(list));
            e.target.value = "";
          }}
          data-testid="import-folder-input"
        />
      </section>

      {bundleBuilding ? (
        <Notice tone="info">
          <div>{copy.buildingBundle}</div>
        </Notice>
      ) : null}

      {bundleError ? (
        <Notice
          title={copy.bundleErrorTitle}
          error={
            bundleError instanceof ImportBundleError
              ? new Error(bundleError.message)
              : bundleError
          }
        />
      ) : null}

      {bundle ? (
        <section className="panel" data-testid="import-preview">
          <div className="panel__title">{copy.previewTitle}</div>
          <div className="result-table">
            <div className="result-table__row">
              <strong>{copy.previewFilesCount}</strong>
              <span>{bundle.filesCount}</span>
            </div>
            <div className="result-table__row">
              <strong>{copy.previewPackages}</strong>
              <span>{bundle.manifest.packages.length}</span>
            </div>
            <div className="result-table__row">
              <strong>{copy.previewTotalBytes}</strong>
              <span>{formatBytes(bundle.totalBytes)}</span>
            </div>
            {bundle.skipped.length > 0 ? (
              <div className="result-table__row">
                <strong>{copy.previewSkipped}</strong>
                <span>{bundle.skipped.length}</span>
              </div>
            ) : null}
          </div>
          {bundle.skipped.length > 0 ? (
            <details>
              <summary>{copy.previewSkippedDetails}</summary>
              <ul>
                {bundle.skipped.map((s) => (
                  <li key={`${s.path}:${s.reason}`}>
                    <code>{s.path}</code> — {skippedLabel(copy, s)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary-button"
              onClick={onStart}
              data-testid="import-start"
            >
              <Play size={16} />
              {copy.start}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

interface PipelineStepsProps {
  copy: ImportCopy;
  stage: PipelineStage;
  activeEvent: TaskEvent | null;
  ingestTaskId?: string;
  synthTaskId?: string;
  lintProposeTaskId?: string;
  lintApplyTaskId?: string;
}

function PipelineSteps({
  copy,
  stage,
  activeEvent,
  ingestTaskId,
  synthTaskId,
  lintProposeTaskId,
  lintApplyTaskId
}: PipelineStepsProps) {
  const currentRank = stageRank(stage);
  return (
    <section className="panel" data-testid="import-pipeline">
      <div className="panel__title">{copy.pipelineTitle}</div>
      <ul className="import-step-list">
        {STEPS.map((step) => {
          const rank = stageRank(step.id);
          const status =
            rank < currentRank
              ? "succeeded"
              : rank === currentRank
              ? "running"
              : "pending";
          const taskId =
            step.id === "ingest"
              ? ingestTaskId
              : step.id === "synth"
              ? synthTaskId
              : step.id === "lint-propose"
              ? lintProposeTaskId
              : step.id === "lint-apply"
              ? lintApplyTaskId
              : undefined;
          return (
            <li className="import-step-row" key={step.id}>
              <StatusPill status={status} label={copy.stages[step.labelKey]} />
              {taskId ? <code>{taskId}</code> : null}
              {status === "running" && activeEvent ? (
                <span>{describeEvent(activeEvent)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface LintReviewProps {
  copy: ImportCopy;
  proposals: FixProposal[];
  initialPicked: number[];
  onApply: (picked: number[]) => void;
  onSkipAll: () => void;
}

function LintReview({
  copy,
  proposals,
  initialPicked,
  onApply,
  onSkipAll
}: LintReviewProps) {
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(initialPicked)
  );
  const togglePick = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <section className="panel" data-testid="import-lint-review">
      <div className="panel__title">{copy.lintReviewTitle}</div>
      <p>{copy.lintReviewHint}</p>
      <div className="query-form query-form--compact">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPicked(new Set(proposals.map((_, i) => i)))}
        >
          {copy.selectAll}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPicked(new Set())}
        >
          {copy.selectNone}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => onApply(Array.from(picked).sort((a, b) => a - b))}
          disabled={picked.size === 0}
          data-testid="import-lint-apply"
        >
          <CheckCircle2 size={16} />
          {copy.applySelected} ({picked.size})
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onSkipAll}
          data-testid="import-lint-skip-all"
        >
          <XCircle size={16} />
          {copy.skipAll}
        </button>
      </div>
      <ul className="result-table">
        {proposals.map((p, i) => (
          <li className="result-table__row" key={p.proposal_id}>
            <input
              type="checkbox"
              checked={picked.has(i)}
              onChange={() => togglePick(i)}
              aria-label={`proposal ${p.proposal_id}`}
            />
            <strong>{p.issue_kind}</strong>
            <code>{p.issue_path}</code>
            <span>{p.issue_detail}</span>
            <span>{p.rationale}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface DoneSummaryProps {
  copy: ImportCopy;
  pipeline: PipelineState;
  onStartOver: () => void;
}

function DoneSummary({ copy, pipeline, onStartOver }: DoneSummaryProps) {
  const apply = pipeline.applyReport;
  return (
    <section className="panel" data-testid="import-done">
      <div className="panel__title">{copy.doneTitle}</div>
      <div className="result-table">
        {pipeline.importResult ? (
          <>
            <div className="result-table__row">
              <strong>{copy.summaryCommitted}</strong>
              <span>{pipeline.importResult.committed.length}</span>
            </div>
            {pipeline.importResult.rejected.length > 0 ? (
              <div className="result-table__row">
                <strong>{copy.summaryRejected}</strong>
                <span>{pipeline.importResult.rejected.length}</span>
              </div>
            ) : null}
            <div className="result-table__row">
              <strong>{copy.summaryBytes}</strong>
              <span>{formatBytes(pipeline.importResult.bytes)}</span>
            </div>
          </>
        ) : null}
        {apply ? (
          <>
            <div className="result-table__row">
              <strong>{copy.summaryApplied}</strong>
              <span>{apply.applied.length}</span>
            </div>
            {apply.skipped.length > 0 ? (
              <div className="result-table__row">
                <strong>{copy.summarySkippedServer}</strong>
                <span>{apply.skipped.length}</span>
              </div>
            ) : null}
          </>
        ) : (pipeline.proposals?.length ?? 0) === 0 ? (
          <div className="result-table__row">
            <strong>{copy.summaryNoLint}</strong>
            <span>—</span>
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="primary-button"
          onClick={onStartOver}
          data-testid="import-restart"
        >
          <Upload size={16} />
          {copy.restart}
        </button>
      </div>
    </section>
  );
}

// ---- Helpers --------------------------------------------------------------

type ImportCopy = (typeof translations)["en"]["pages"]["import"];

function isRunning(stage: PipelineStage): boolean {
  return (
    stage === "uploading" ||
    stage === "ingest" ||
    stage === "synth" ||
    stage === "lint-propose" ||
    stage === "lint-apply"
  );
}

function describeEvent(event: TaskEvent): string {
  if (event.type === "progress") {
    const pct = event.total > 0 ? Math.round((event.current / event.total) * 100) : 0;
    return `${event.phase} ${event.current}/${event.total} (${pct}%)`;
  }
  if (event.type === "log") return event.message;
  if (event.type === "partial") return `partial: ${event.kind}`;
  if (event.type === "task_started") return `started: ${event.op}`;
  if (event.type === "error") return `error: ${event.message}`;
  return event.type;
}

function taskErrorMessage(
  final: Extract<TaskEvent, { type: "final" }> | null,
  fallback: string
): string {
  if (!final || !final.error) return fallback;
  const m = final.error.message;
  return typeof m === "string" ? m : fallback;
}

function skippedLabel(copy: ImportCopy, s: SkippedFile): string {
  switch (s.reason) {
    case "unsupported_extension":
      return copy.skippedUnsupported;
    case "empty_body":
      return copy.skippedEmpty;
    case "asset_missing":
      return `${copy.skippedAssetMissing}${s.detail ? ` (${s.detail})` : ""}`;
    case "unreferenced_asset":
      return copy.skippedUnreferenced;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

class PipelineFailure extends Error {
  readonly failedStage: PipelineStage;
  constructor(failedStage: PipelineStage, message: string) {
    super(message);
    this.name = "PipelineFailure";
    this.failedStage = failedStage;
  }
}
