import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Upload } from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import {
  buildImportBundle,
  type ImportBundleResult
} from "../utils/import-bundle";
import {
  activeTaskId,
  clearPipelineState,
  initialState,
  loadPipelineState,
  savePipelineState,
  type PipelineState
} from "../state/import-pipeline";
import type {
  ApplyReport,
  FixProposalReport,
  TaskEvent
} from "../types";
import { IdlePicker } from "./import/IdlePicker";
import { PipelineSteps } from "./import/PipelineSteps";
import { LintReview } from "./import/LintReview";
import { DoneSummary } from "./import/DoneSummary";
import { isRunningStage, PipelineFailure, taskErrorMessage } from "./import/format";

interface ImportPageProps {
  client: DikwClient;
  locale?: Locale;
}

/** Top-level Import page. Owns the pipeline state machine + orchestration; all
 *  visual surfaces live in ``./import/`` so this file stays readable. */
export function ImportPage({ client, locale = "en" }: ImportPageProps) {
  const copy = translations[locale].pages.import;
  const coreId = client.coreId;
  // Lazy-init from storage so a refresh during a task stage doesn't lose the
  // persisted task id. If we initialized with ``initialState()`` then saved on
  // the next effect tick, the save would clear storage before the resume
  // effect could read it.
  const [pipeline, setPipeline] = useState<PipelineState>(() =>
    loadPipelineState(coreId)
  );
  // Track whether the current pipeline was resumed from storage rather than
  // started in this session — drives the resume banner over the stepper.
  const [wasResumed, setWasResumed] = useState<boolean>(
    () => pipeline.stage !== "idle"
  );
  const [bundle, setBundle] = useState<ImportBundleResult | null>(null);
  const [bundleError, setBundleError] = useState<unknown>(null);
  const [bundleBuilding, setBundleBuilding] = useState(false);
  const [activeEvent, setActiveEvent] = useState<TaskEvent | null>(null);
  const [pipelineStartedAt, setPipelineStartedAt] = useState<number | null>(
    null
  );
  const controllerRef = useRef<AbortController | null>(null);
  // Generation counter so a slow ``buildImportBundle`` from an earlier
  // selection can't overwrite a fresher one that finished first.
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
      // Seed startedAt so the stepper has something to count from on resume
      // — without this the elapsed segment is blank on the very code path
      // users care about most (mid-pipeline refresh).
      setPipelineStartedAt(Date.now());
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
    bundleGenRef.current += 1;
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
    if (controllerRef.current && !controllerRef.current.signal.aborted) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setActiveEvent(null);
    setWasResumed(false);
    setPipelineStartedAt(Date.now());
    setPipeline({ stage: "uploading", coreUrl: coreId });
    try {
      const importResult = await client.importBundle(
        bundle.payload,
        bundle.manifestJson,
        controller.signal
      );

      const ingestHandle = await client.startIngest({}, controller.signal);
      setPipeline((p) => ({
        ...p,
        stage: "ingest",
        importResult,
        ingestTaskId: ingestHandle.task_id
      }));
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

      const synthHandle = await client.startSynth({}, controller.signal);
      setPipeline((p) => ({
        ...p,
        stage: "synth",
        synthTaskId: synthHandle.task_id
      }));
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

      const proposeHandle = await client.startLintPropose({}, controller.signal);
      setPipeline((p) => ({
        ...p,
        stage: "lint-propose",
        lintProposeTaskId: proposeHandle.task_id
      }));
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
      handlePipelineError(err, controller);
    }
  }, [bundle, client, consumeTask, coreId]);

  const applyLint = useCallback(
    async (picked: number[]) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setActiveEvent(null);
      setWasResumed(false);
      setPipeline((p) => ({ ...p, picked }));
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
        setPipeline((p) => ({
          ...p,
          stage: "lint-apply",
          lintApplyTaskId: applyHandle.task_id
        }));
        const applyFinal = await consumeTask(
          applyHandle.task_id,
          controller.signal
        );
        if (applyFinal?.status === "cancelled") {
          throw new PipelineFailure("lint-apply", "lint apply cancelled");
        }
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
        handlePipelineError(err, controller);
      }
    },
    [client, consumeTask, pipeline.lintProposeTaskId]
  );

  const skipAllLint = useCallback(() => {
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
        if (persisted.stage === "ingest") {
          const synthHandle = await client.startSynth({}, controller.signal);
          setPipeline((p) => ({
            ...p,
            stage: "synth",
            synthTaskId: synthHandle.task_id
          }));
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
          await finalizeProposeAndGate(
            persisted.lintProposeTaskId!,
            controller
          );
        } else if (persisted.stage === "lint-apply") {
          const applyReport = await client.getTaskResult<ApplyReport>(
            persisted.lintApplyTaskId!,
            controller.signal
          );
          setPipeline((p) => ({ ...p, stage: "done", applyReport }));
        }
      } catch (err) {
        handlePipelineError(err, controller);
      }
    },
    [client, consumeTask]
  );

  async function continueFromSynth(controller: AbortController) {
    const proposeHandle = await client.startLintPropose({}, controller.signal);
    setPipeline((p) => ({
      ...p,
      stage: "lint-propose",
      lintProposeTaskId: proposeHandle.task_id
    }));
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

  function handlePipelineError(err: unknown, owner: AbortController) {
    // Stale rejection from a controller this owner no longer represents
    // (cancelled-then-restarted, or torn down by startOver) must not clobber
    // the current pipeline state. Compare identity, not just `.aborted` —
    // after startOver `controllerRef.current` may be null, which would
    // otherwise let the late catch fall through.
    if (owner !== controllerRef.current || owner.signal.aborted) {
      return;
    }
    const cancelled =
      err instanceof DikwClientError && err.code === "task_cancelled";
    setPipeline((p) => ({
      ...p,
      stage: cancelled ? "cancelled" : "failed",
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
      try {
        await client.cancelTask(taskId);
      } catch {
        // Swallow — UI already reflects the user's intent; the server will
        // either honor the cancel or eventually surface a different terminal
        // status on its own. Re-throwing here would replace the cancelled
        // state with a "failed" Notice.
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
    setWasResumed(false);
    setPipelineStartedAt(null);
    resetPicker();
  }, [resetPicker]);

  // ---- Render branches -----------------------------------------------------

  const stage = pipeline.stage;
  const running = isRunningStage(stage);

  return (
    <div className="page-stack import-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.description}</p>
        </div>
        {running ? (
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
          onDropError={setBundleError}
          bundle={bundle}
          bundleBuilding={bundleBuilding}
          bundleError={bundleError}
          onStart={startPipeline}
          onReset={resetPicker}
        />
      ) : null}

      {running ? (
        <PipelineSteps
          copy={copy}
          stage={stage}
          activeEvent={activeEvent}
          wasResumed={wasResumed}
          startedAt={pipelineStartedAt}
          importResult={pipeline.importResult ?? null}
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
        <DoneSummary copy={copy} pipeline={pipeline} onStartOver={startOver} />
      ) : null}

      {(stage === "failed" || stage === "cancelled") && pipeline.error ? (
        <Notice
          title={stage === "failed" ? copy.errorTitle : copy.cancelledTitle}
          tone={stage === "failed" ? "bad" : "warn"}
        >
          <div>
            {copy.errorStageLabel}: {pipeline.error.stage}
          </div>
          <div>{pipeline.error.message}</div>
          {pipeline.error.code ? (
            <div className="notice__code">{pipeline.error.code}</div>
          ) : null}
          <div className="import-error-actions">
            <button
              type="button"
              className="primary-button"
              onClick={startOver}
            >
              <Upload size={16} />
              {copy.restart}
            </button>
          </div>
        </Notice>
      ) : null}
    </div>
  );
}
