import type { PipelineState } from "../../state/import-pipeline";
import type { ImportCopy } from "./format";

export function ImportOutcomes({ copy, pipeline }: { copy: ImportCopy; pipeline: PipelineState }) {
  const result = pipeline.importResult;
  if (!result) return null;
  return (
    <>
      {[
        { entries: result.rejected, label: copy.summaryRejected, kind: "rejected" },
        { entries: result.warnings ?? [], label: copy.summaryWarnings, kind: "warnings" },
      ].map(({ entries, label, kind }) =>
        entries.length ? (
          <section
            className="panel import-outcomes"
            key={kind}
            data-testid={`import-${kind}-packages`}
          >
            <h3>{label}</h3>
            <ul>
              {entries.map((entry, index) => (
                <li key={`${entry.id}-${index}`}>
                  <div>
                    {pipeline.packagePaths?.[entry.id] ??
                      String(entry.detail?.md_path ?? `${copy.summaryPackage} ${entry.id}`)}
                  </div>
                  <code>{entry.code}</code>
                  {entry.code === "source_path_exists" ? <div>{copy.sourcePathExists}</div> : null}
                  {entry.code === "source_asset_exists" ? (
                    <div>{copy.sourceAssetExists}</div>
                  ) : null}
                  {entry.code === "source_asset_scope_unknown" ? (
                    <div>{copy.sourceAssetScopeUnknown}</div>
                  ) : null}
                  {entry.code === "source_content_matches" ? (
                    <div>{copy.sourceContentMatches}</div>
                  ) : null}
                  {entry.detail ? <div>{JSON.stringify(entry.detail)}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}
