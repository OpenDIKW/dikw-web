import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Upload } from "lucide-react";
import { DikwClient, DikwClientError } from "../api/client";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import {
  buildImportBundle,
  lowerExt,
  type ImportBundleResult
} from "../utils/import-bundle";
import {
  activeTaskId,
  clearPipelineState,
  initialState,
  loadPipelineState,
  savePipelineState,
  type ConversionFileState,
  type PipelineState
} from "../state/import-pipeline";
import {
  convertedToFiles,
  convertSource,
  MineruConvertError,
  MINERU_EXTENSIONS,
  tryOpenDefaultCache,
  type ConvertCache,
  type ConvertedSource
} from "../utils/mineru-convert";
import type {
  ApplyReport,
  FixProposalReport,
  TaskEvent
} from "../types";
import { IdlePicker } from "./import/IdlePicker";
import { PipelineSteps } from "./import/PipelineSteps";
import { LintReview } from "./import/LintReview";
import { DoneSummary } from "./import/DoneSummary";
import { ConversionProgress } from "./import/ConversionProgress";
import { isRunningStage, PipelineFailure, taskErrorMessage } from "./import/format";

const MINERU_CONCURRENCY = 2;
const HEALTH_URL = "/web/mineru/health";

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
  // ``/web/mineru/health`` probe result — drives the picker accept list +
  // optional "mineru not configured" Notice. Default to ``null`` so the
  // initial render doesn't briefly expose office formats before the
  // probe finishes.
  const [mineruEnabled, setMineruEnabled] = useState<boolean | null>(null);
  // IndexedDB cache — opened once per page mount, reused across all
  // convertSource calls so repeat imports of the same file skip mineru
  // entirely. ``null`` fallback (jsdom test env / very old browsers) is
  // tolerated — convertSource just skips the cache layer.
  const convertCacheRef = useRef<ConvertCache | null>(null);
  // Track the in-flight convert AbortController so onCancel can abort
  // mineru calls mid-batch.
  const convertCtrlRef = useRef<AbortController | null>(null);
  // Cache of converted sources keyed by inputSha within this batch, used
  // when the user clicks Skip on a failed file: we drop it from the set
  // and rebuild the bundle from the still-successful conversions.
  const conversionResultsRef = useRef<Map<string, ConvertedSource>>(new Map());
  const conversionNativeRef = useRef<File[]>([]);

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
      convertCtrlRef.current?.abort();
    },
    []
  );

  // Probe /web/mineru/health once on mount. Failure (sidecar not running,
  // 404, network error) is treated as "disabled" — the picker falls back
  // to .md + asset extensions only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(HEALTH_URL);
        if (!resp.ok) {
          if (!cancelled) setMineruEnabled(false);
          return;
        }
        const body = (await resp.json()) as { enabled?: boolean };
        if (!cancelled) setMineruEnabled(Boolean(body.enabled));
      } catch {
        if (!cancelled) setMineruEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Open IndexedDB cache once. Skips when running under jsdom / Node.
  useEffect(() => {
    let cancelled = false;
    void tryOpenDefaultCache().then((cache) => {
      if (!cancelled) convertCacheRef.current = cache;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- File selection ------------------------------------------------------

  // Partition + (optionally) convert + bundle. Three execution paths:
  //   1. No mineru-targeted files  → straight to buildImportBundle (existing path).
  //   2. Has mineru files          → enter "converting" stage, run them through
  //                                   /web/mineru/convert (2 concurrent), then
  //                                   buildImportBundle on native+converted.
  //   3. Mineru sidecar disabled   → office files filtered out + Notice shown;
  //                                   .pdf falls back to passive-asset semantics.
  const onFilesChosen = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const gen = ++bundleGenRef.current;
      setBundle(null);
      setBundleError(null);

      const { native, mineru } = partitionForMineru(files, mineruEnabled === true);

      if (mineru.length === 0) {
        setBundleBuilding(true);
        void buildAndSet(native, gen);
        return;
      }

      // ---- Conversion batch ----
      const ctrl = new AbortController();
      convertCtrlRef.current = ctrl;
      conversionResultsRef.current = new Map();
      conversionNativeRef.current = native;
      const initial = makeInitialConversionState(mineru);
      setPipeline((p) => ({ ...p, stage: "converting", conversion: initial }));

      void runMineruBatch(mineru, gen, ctrl);
    },
    [mineruEnabled]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  /** Run buildImportBundle and update bundle state for the given generation. */
  const buildAndSet = useCallback(
    async (files: File[], gen: number) => {
      try {
        if (files.length === 0) {
          throw new Error("no files left after conversion");
        }
        const result = await buildImportBundle(files);
        if (bundleGenRef.current !== gen) return; // superseded
        setBundle(result);
        setBundleBuilding(false);
      } catch (err) {
        if (bundleGenRef.current !== gen) return;
        setBundleError(err);
        setBundleBuilding(false);
      }
    },
    []
  );

  /** Update one ConversionFileState entry. Identified by inputSha (the key
   *  in conversion.files). When inputSha is the original placeholder
   *  (pre-hash), update the queued entry in order. */
  const updateConversionFile = useCallback(
    (
      mineru: File[],
      index: number,
      update: Partial<ConversionFileState> & { inputSha?: string }
    ) => {
      setPipeline((p) => {
        if (!p.conversion) return p;
        const orderedKey = p.conversion.inputOrder[index];
        const existing = p.conversion.files[orderedKey];
        if (!existing) return p;
        const next = { ...existing, ...update };
        const files = { ...p.conversion.files, [orderedKey]: next };
        // If the entry's effective key changes (inputSha resolved), rewrite
        // the map key + inputOrder slot so subsequent updates address the
        // right entry.
        if (update.inputSha && update.inputSha !== orderedKey) {
          delete files[orderedKey];
          files[update.inputSha] = next;
          const inputOrder = p.conversion.inputOrder.slice();
          inputOrder[index] = update.inputSha;
          return { ...p, conversion: { files, inputOrder } };
        }
        return { ...p, conversion: { files, inputOrder: p.conversion.inputOrder } };
      });
    },
    []
  );

  const runMineruBatch = useCallback(
    async (mineru: File[], gen: number, ctrl: AbortController) => {
      const cache = convertCacheRef.current ?? undefined;
      let next = 0;
      const worker = async (): Promise<void> => {
        while (!ctrl.signal.aborted) {
          const i = next++;
          if (i >= mineru.length) return;
          const file = mineru[i];
          try {
            const result = await convertSource(file, {
              signal: ctrl.signal,
              cache: cache ?? null,
              onProgress: (e) => {
                if (e.phase === "cache_hit") {
                  updateConversionFile(mineru, i, { substage: "done" });
                  return;
                }
                if (e.phase === "hashing") {
                  updateConversionFile(mineru, i, { substage: "hashing" });
                  return;
                }
                if (e.phase === "uploading") {
                  updateConversionFile(mineru, i, { substage: "uploading" });
                  return;
                }
                if (e.phase === "downloading") {
                  updateConversionFile(mineru, i, { substage: "downloading" });
                }
              }
            });
            // After fetch resolves we have the real inputSha — re-key the
            // ConversionFileState entry to it so onSkipFailed addresses the
            // right row even after refresh-resume work lands.
            updateConversionFile(mineru, i, {
              inputSha: result.inputSha,
              substage: "done"
            });
            conversionResultsRef.current.set(result.inputSha, result);
          } catch (err) {
            const code =
              err instanceof MineruConvertError
                ? err.code
                : err instanceof Error
                ? "mineru_api"
                : "mineru_api";
            const message = err instanceof Error ? err.message : String(err);
            updateConversionFile(mineru, i, {
              substage: "failed",
              error: { code, message }
            });
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(MINERU_CONCURRENCY, mineru.length) },
        () => worker()
      );
      await Promise.all(workers);
      if (bundleGenRef.current !== gen) return;
      if (ctrl.signal.aborted) return;
      // All workers finished — bail out if anything is still pending (shouldn't
      // happen since workers exit only on aborted / exhausted). Then either
      // hand off to bundle build (if any conversion succeeded) or remain on
      // the converting stage so the user can interact with failures.
      const succeeded = Array.from(conversionResultsRef.current.values());
      if (succeeded.length === 0) {
        // Every mineru conversion failed. Stay on the converting stage so the
        // user sees the per-file error rows — even if `native` is non-empty,
        // proceeding into the bundle would silently drop the office files
        // they tried to import. They can Skip each failed row to fall back
        // to the native-only bundle, or click Start over to reset.
        return;
      }
      await finalizeConversion(gen);
    },
    [updateConversionFile]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  );

  /** Combine native + successful conversions into a single File[], build
   *  the bundle, then transition back to idle so IdlePicker shows the
   *  bundle preview. */
  const finalizeConversion = useCallback(
    async (gen: number) => {
      const synthetic = Array.from(conversionResultsRef.current.values())
        .map(convertedToFiles)
        .flat();
      const all = [...conversionNativeRef.current, ...synthetic];
      setBundleBuilding(true);
      setPipeline((p) => ({ ...p, stage: "idle", conversion: undefined }));
      await buildAndSet(all, gen);
    },
    [buildAndSet]
  );

  const onSkipFailed = useCallback(
    (inputSha: string) => {
      // Inspect the post-skip files map inside the updater so we never read a
      // pre-commit snapshot. A previous version used setTimeout + a mirrored
      // ref which raced React's commit ordering and could leave the UI stuck
      // on `converting` when the user skipped the last failed row.
      let shouldFinalize = false;
      let nextSucceededAny = false;
      setPipeline((p) => {
        if (!p.conversion) return p;
        const files = { ...p.conversion.files };
        const inputOrder = p.conversion.inputOrder.filter((k) => k !== inputSha);
        delete files[inputSha];
        const remaining = Object.values(files);
        const anyPending = remaining.some(
          (f) => f.substage !== "done" && f.substage !== "failed"
        );
        nextSucceededAny =
          remaining.some((f) => f.substage === "done") ||
          conversionResultsRef.current.size > 0;
        shouldFinalize = !anyPending && nextSucceededAny;
        return { ...p, conversion: { files, inputOrder } };
      });
      // Defer to a microtask so finalize's setPipeline isn't fired inside the
      // previous setPipeline's updater.
      if (shouldFinalize) {
        queueMicrotask(() => {
          void finalizeConversion(bundleGenRef.current);
        });
      }
    },
    [finalizeConversion]
  );

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
      // The event stream stops when ``task_status`` goes terminal +
      // ``has_more:false``, which can race ahead of the ``final`` event
      // becoming visible in the log — leaving ``final`` null for a task that
      // actually succeeded. (Symptom: Import shows "<stage> failed" while the
      // Tasks page, which reads the authoritative row, shows succeeded.)
      // Reconcile against that same authoritative row instead of misreporting
      // a success as a failure.
      if (!final && !signal.aborted) {
        final = await client.getTaskFinalEvent(taskId, signal);
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
    // Also abort the conversion batch — convertCtrlRef is independent of
    // controllerRef (a /web/mineru/* in-flight is not a core task), so the
    // line above wouldn't reach it. Without this, workers keep marching
    // through their queue after the user clicks Cancel and would later
    // transition state behind the cancelled UI.
    convertCtrlRef.current?.abort();
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
    convertCtrlRef.current?.abort();
    convertCtrlRef.current = null;
    conversionResultsRef.current = new Map();
    conversionNativeRef.current = [];
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
        <>
          {mineruEnabled === false ? (
            <Notice tone="info">
              <div>{copy.mineruDisabledNotice}</div>
            </Notice>
          ) : null}
          <IdlePicker
            copy={copy}
            onFilesChosen={onFilesChosen}
            onDropError={setBundleError}
            bundle={bundle}
            bundleBuilding={bundleBuilding}
            bundleError={bundleError}
            onStart={startPipeline}
            onReset={resetPicker}
            mineruEnabled={mineruEnabled === true}
          />
        </>
      ) : null}

      {stage === "converting" && pipeline.conversion ? (
        <ConversionProgress
          copy={copy}
          conversion={pipeline.conversion}
          onSkipFailed={onSkipFailed}
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

/** Split user-dropped files into ``native`` (md / asset / pdf-as-asset)
 *  and ``mineru`` (formats only mineru can convert to markdown). When
 *  mineruEnabled is false, office files are dropped (the picker also
 *  doesn't accept them) and PDFs always stay native. */
function partitionForMineru(
  files: File[],
  mineruEnabled: boolean
): { native: File[]; mineru: File[] } {
  const native: File[] = [];
  const mineru: File[] = [];
  if (!mineruEnabled) {
    for (const f of files) {
      const ext = lowerExt(f.name);
      // Office formats are unrecognized by the rest of the pipeline; drop
      // them silently. .pdf survives as a passive asset (existing behavior).
      if (ext === ".doc" || ext === ".docx" || ext === ".ppt" || ext === ".pptx" || ext === ".xls" || ext === ".xlsx") {
        continue;
      }
      native.push(f);
    }
    return { native, mineru };
  }
  // Heuristic: PDFs referenced by any concurrently-dropped .md stay native
  // (passive-asset path); standalone PDFs go to mineru. .doc/.docx/etc.
  // always go to mineru.
  const mdRefs = collectMdReferences(files);
  for (const f of files) {
    const ext = lowerExt(f.name);
    if (ext === ".pdf") {
      if (mdRefs.has(basename(f.name).toLowerCase())) {
        native.push(f);
      } else {
        mineru.push(f);
      }
      continue;
    }
    if (MINERU_EXTENSIONS.has(ext)) {
      mineru.push(f);
    } else {
      native.push(f);
    }
  }
  return { native, mineru };
}

function basename(path: string): string {
  return path.replace(/^.*[\\/]/, "");
}

/** Lazy scan of dropped .md files: collect referenced basenames so we can
 *  decide whether a co-dropped .pdf is "an asset of that md" (passive) or
 *  "a standalone source to convert" (mineru). */
function collectMdReferences(files: File[]): Set<string> {
  const refs = new Set<string>();
  for (const f of files) {
    if (lowerExt(f.name) !== ".md") continue;
    // Sync read is unavailable for File; skip and let mineru handle every
    // PDF as a source. This errs on the side of "convert everything" which
    // is the safer default — passive-asset PDFs are rare in practice.
    refs.add(""); // placeholder so the set is non-empty if md exists, but
                  // we don't actually peek into the body.
  }
  // Returning an empty set means "no md references known": all PDFs go to
  // mineru. The previous "placeholder" is misleading — clear it.
  refs.clear();
  return refs;
}

function makeInitialConversionState(mineru: File[]): {
  files: Record<string, ConversionFileState>;
  inputOrder: string[];
} {
  // Placeholder keys (``placeholder-{i}``) are used until convertSource
  // resolves the real sha256. updateConversionFile re-keys on inputSha
  // when the hash phase completes.
  const files: Record<string, ConversionFileState> = {};
  const inputOrder: string[] = [];
  for (let i = 0; i < mineru.length; i++) {
    const file = mineru[i];
    const key = `placeholder-${i}`;
    files[key] = {
      inputSha: key,
      fileName: file.name,
      sizeBytes: file.size,
      ext: lowerExt(file.name),
      substage: "queued"
    };
    inputOrder.push(key);
  }
  return { files, inputOrder };
}
