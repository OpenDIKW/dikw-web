import { useEffect, useState } from "react";
import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import type { ConversionFileState, ConversionState } from "../../state/import-pipeline";
import { formatBytes, formatElapsed, type ImportCopy } from "./format";

interface ConversionProgressProps {
  copy: ImportCopy;
  conversion: ConversionState;
  /** Drop a single failed entry from the in-flight queue so the batch can
   *  proceed without it. UI only — parent decides what "skip" means. */
  onSkipFailed: (inputSha: string) => void;
}

/** A row is "in flight" (vs queued / done / failed) whenever the mineru
 *  round-trip is underway. The whole hashing→upload→server-convert→download
 *  window is one indeterminate wait from the browser's side — the sidecar is
 *  a single blocking request with no progress stream — so every in-flight
 *  substage gets the same animated bar + live timer. */
function isActive(substage: ConversionFileState["substage"]): boolean {
  return (
    substage === "hashing" ||
    substage === "uploading" ||
    substage === "polling" ||
    substage === "downloading"
  );
}

/** Renders one row per file currently going through /web/mineru/convert.
 *  No spinner duplication with PipelineSteps — this surface is exclusive
 *  to the ``converting`` stage. */
export function ConversionProgress({ copy, conversion, onSkipFailed }: ConversionProgressProps) {
  const c = copy.conversion;
  const count = conversion.inputOrder.length;
  const queuedTemplate = count === 1 ? c.queuedOne : c.queuedMany;

  const anyActive = conversion.inputOrder.some((sha) => {
    const f = conversion.files[sha];
    return f != null && isActive(f.substage);
  });

  // Tick a clock every second so the per-row elapsed timer advances while the
  // mineru round-trip sits silent — a multi-minute server-side conversion with
  // a frozen timer reads as a hung page. Mirrors PipelineSteps' elapsed clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="panel" data-testid="conversion-progress">
      <header className="panel__header">
        <h2 className="panel__title">{c.title}</h2>
        <p className="panel__subtitle">{queuedTemplate.replace("{n}", String(count))}</p>
        {anyActive ? (
          <p className="conversion-hint" data-testid="conversion-hint">
            {c.hint}
          </p>
        ) : null}
      </header>
      <ul className="conversion-list">
        {conversion.inputOrder.map((sha) => {
          const file = conversion.files[sha];
          if (!file) return null;
          const active = isActive(file.substage);
          return (
            <li
              key={sha}
              className={`conversion-row conversion-row--${file.substage}`}
              data-testid="conversion-row"
            >
              <div className="conversion-row__line">
                <span className="conversion-row__icon" aria-hidden="true">
                  {iconFor(file)}
                </span>
                <span className="conversion-row__name" title={file.fileName}>
                  {file.fileName}
                </span>
                <span className="conversion-row__meta">
                  {formatBytes(file.sizeBytes)} · {c.substages[file.substage]}
                  {active && file.startedAt != null ? (
                    <>
                      {" · "}
                      <span
                        className="conversion-row__elapsed"
                        data-testid="conversion-elapsed"
                        aria-label={c.elapsedLabel}
                      >
                        {formatElapsed(now - file.startedAt)}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
              {active ? (
                <span
                  className="conversion-row__bar"
                  data-testid="conversion-bar"
                  aria-hidden="true"
                >
                  <span className="conversion-row__bar-fill" />
                </span>
              ) : null}
              {file.substage === "failed" && file.error ? (
                <div className="conversion-row__fail">
                  <span className="conversion-row__error">{file.error.message}</span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onSkipFailed(file.inputSha)}
                    data-testid="conversion-skip"
                  >
                    <X size={14} /> {c.skip}
                  </button>
                </div>
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
