import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import type {
  ConversionFileState,
  ConversionState
} from "../../state/import-pipeline";
import { formatBytes } from "./format";

interface ConversionProgressProps {
  conversion: ConversionState;
  /** Drop a single failed entry from the in-flight queue so the batch can
   *  proceed without it. UI only — parent decides what "skip" means. */
  onSkipFailed: (inputSha: string) => void;
}

/** Renders one row per file currently going through /web/mineru/convert.
 *  No spinner duplication with PipelineSteps — this surface is exclusive
 *  to the ``converting`` stage. */
export function ConversionProgress({
  conversion,
  onSkipFailed
}: ConversionProgressProps) {
  return (
    <section className="panel" data-testid="conversion-progress">
      <header className="panel__header">
        <h2 className="panel__title">Converting via mineru</h2>
        <p className="panel__subtitle">
          {conversion.inputOrder.length} file
          {conversion.inputOrder.length === 1 ? "" : "s"} queued
        </p>
      </header>
      <ul className="conversion-list">
        {conversion.inputOrder.map((sha) => {
          const file = conversion.files[sha];
          if (!file) return null;
          return (
            <li key={sha} className="conversion-row" data-testid="conversion-row">
              <span className="conversion-row__icon" aria-hidden="true">
                {iconFor(file)}
              </span>
              <span className="conversion-row__name">{file.fileName}</span>
              <span className="conversion-row__meta">
                {formatBytes(file.sizeBytes)} · {labelFor(file.substage)}
              </span>
              {file.substage === "failed" && file.error ? (
                <>
                  <span className="conversion-row__error">
                    {file.error.message}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onSkipFailed(file.inputSha)}
                    data-testid="conversion-skip"
                  >
                    <X size={14} /> Skip
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function iconFor(file: ConversionFileState) {
  if (file.substage === "done") return <Check size={16} aria-label="done" />;
  if (file.substage === "failed") return <AlertCircle size={16} aria-label="failed" />;
  if (file.substage === "queued") return <FileText size={16} aria-label="queued" />;
  return <Loader2 size={16} className="spin" aria-label="running" />;
}

function labelFor(substage: ConversionFileState["substage"]): string {
  switch (substage) {
    case "queued":
      return "queued";
    case "hashing":
      return "hashing";
    case "uploading":
      return "uploading to mineru";
    case "polling":
      return "waiting on mineru";
    case "downloading":
      return "downloading result";
    case "done":
      return "done";
    case "failed":
      return "failed";
  }
}
