import {
  BookOpen,
  CheckCircle2,
  Info,
  Network,
  Upload
} from "lucide-react";
import type { PipelineState } from "../../state/import-pipeline";
import { formatBytes, type ImportCopy } from "./format";

interface DoneSummaryProps {
  copy: ImportCopy;
  pipeline: PipelineState;
  onStartOver: () => void;
}

export function DoneSummary({ copy, pipeline, onStartOver }: DoneSummaryProps) {
  const apply = pipeline.applyReport;
  const importResult = pipeline.importResult;
  const totalProposals = pipeline.proposals?.length ?? 0;
  const pickedCount = pipeline.picked?.length ?? 0;
  const userSkipped = Math.max(0, totalProposals - pickedCount);

  return (
    <>
      <div className="import-done-banner" data-testid="import-done">
        <div className="import-done-banner__icon" aria-hidden="true">
          <CheckCircle2 size={28} />
        </div>
        <div>
          <div className="import-done-banner__headline">{copy.doneTitle}</div>
          <div className="import-done-banner__body">
            {copy.doneBannerHeadline}
          </div>
        </div>
        <div className="import-done-banner__actions">
          <button
            type="button"
            className="secondary-button"
            data-testid="import-done-open-wiki"
            onClick={() => {
              window.location.hash = "wiki";
            }}
          >
            <BookOpen size={16} />
            {copy.doneOpenWiki}
          </button>
          <button
            type="button"
            className="secondary-button"
            data-testid="import-done-open-graph"
            onClick={() => {
              window.location.hash = "graph";
            }}
          >
            <Network size={16} />
            {copy.doneOpenGraph}
          </button>
        </div>
      </div>

      <div className="import-done-grid">
        <section className="panel import-done-card">
          <div className="import-done-card__title">{copy.doneCardAdded}</div>
          <dl className="import-done-card__stats">
            {importResult ? (
              <>
                <dt>{copy.summaryCommitted}</dt>
                <dd>{importResult.committed.length}</dd>
                {importResult.rejected.length > 0 ? (
                  <>
                    <dt>{copy.summaryRejected}</dt>
                    <dd>{importResult.rejected.length}</dd>
                  </>
                ) : null}
                <dt>{copy.summaryBytes}</dt>
                <dd>{formatBytes(importResult.bytes)}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="panel import-done-card">
          <div className="import-done-card__title">{copy.doneCardLint}</div>
          <dl className="import-done-card__stats">
            {apply ? (
              <>
                <dt>{copy.summaryApplied}</dt>
                <dd>{apply.applied.length}</dd>
                {apply.skipped.length > 0 ? (
                  <>
                    <dt>{copy.summarySkippedServer}</dt>
                    <dd>{apply.skipped.length}</dd>
                  </>
                ) : null}
              </>
            ) : totalProposals === 0 ? (
              <>
                <dt>{copy.summaryNoLint}</dt>
                <dd>—</dd>
              </>
            ) : null}
            {totalProposals > 0 ? (
              <>
                <dt>{copy.summaryProposalsTotal}</dt>
                <dd>{totalProposals}</dd>
                {userSkipped > 0 ? (
                  <>
                    <dt>{copy.summarySkippedUser}</dt>
                    <dd>{userSkipped}</dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
          <div className="import-done-card__history">
            <Info size={12} className="import-icon-inline" />
            {copy.doneTaskHistoryHint}
          </div>
        </section>
      </div>

      <div className="import-done-tail">
        <span className="import-done-tail__lead">{copy.doneAnotherBatch}</span>
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
    </>
  );
}
