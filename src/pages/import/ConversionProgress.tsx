import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import type {
  ConversionFileState,
  ConversionState
} from "../../state/import-pipeline";
import { formatBytes, type ImportCopy } from "./format";

interface ConversionProgressProps {
  copy: ImportCopy;
  conversion: ConversionState;
  /** Drop a single failed entry from the in-flight queue so the batch can
   *  proceed without it. UI only — parent decides what "skip" means. */
  onSkipFailed: (inputSha: string) => void;
}

/** Renders one row per file currently going through /web/mineru/convert.
 *  No spinner duplication with PipelineSteps — this surface is exclusive
 *  to the ``converting`` stage. */
export function ConversionProgress({
  copy,
  conversion,
  onSkipFailed
}: ConversionProgressProps) {
  const c = copy.conversion;
  const count = conversion.inputOrder.length;
  const queuedTemplate = count === 1 ? c.queuedOne : c.queuedMany;
  return (
    <section className="panel" data-testid="conversion-progress">
      <header className="panel__header">
        <h2 className="panel__title">{c.title}</h2>
        <p className="panel__subtitle">
          {queuedTemplate.replace("{n}", String(count))}
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
                {formatBytes(file.sizeBytes)} · {c.substages[file.substage]}
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
                    <X size={14} /> {c.skip}
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
