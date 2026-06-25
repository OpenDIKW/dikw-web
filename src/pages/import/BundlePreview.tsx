import { useMemo } from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Play, X } from "lucide-react";
import { Button } from "../../components/Button";
import type { ImportBundleResult } from "../../utils/import-bundle";
import { formatBytes, skippedTag, type ImportCopy } from "./format";

interface BundlePreviewProps {
  copy: ImportCopy;
  bundle: ImportBundleResult;
  onStart: () => void;
  onReset: () => void;
}

export function BundlePreview({ copy, bundle, onStart, onReset }: BundlePreviewProps) {
  // Split manifest entries into markdown packages (with ref count) and assets.
  const included = useMemo(() => {
    const mdPaths = new Set(bundle.manifest.packages.map((p) => p.md_path));
    const refsByMd = new Map<string, number>();
    for (const pkg of bundle.manifest.packages) {
      refsByMd.set(pkg.md_path, pkg.asset_paths.length);
    }
    return bundle.manifest.files.map((f) => ({
      path: f.path,
      bytes: f.size,
      isMd: mdPaths.has(f.path),
      refs: refsByMd.get(f.path) ?? 0,
    }));
  }, [bundle]);

  const mdCount = bundle.manifest.packages.length;
  const assetCount = included.length - mdCount;
  const skippedCount = bundle.skipped.length;

  return (
    <section className="panel" data-testid="import-preview">
      <div className="import-preview-head">
        <div>
          <div className="import-preview-head__title">{copy.previewTitle}</div>
          <div className="import-preview-head__hint">
            {mdCount} {copy.previewPackagesShort} · {assetCount} {copy.previewAssets} ·{" "}
            {formatBytes(bundle.totalBytes)}
            {skippedCount > 0 ? (
              <>
                {" · "}
                <span className="import-preview-skipped-count">
                  {skippedCount} {copy.previewSkipped.toLowerCase()}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="import-preview-head__actions">
          <Button variant="secondary" onClick={onReset}>
            <X size={14} />
            {copy.clearSelection}
          </Button>
          <Button onClick={onStart} data-testid="import-start">
            <Play size={16} />
            {copy.start}
          </Button>
        </div>
      </div>

      <hr className="import-divider" />

      <div className="import-preview-body">
        <div>
          <div className="import-eyebrow">
            {copy.previewIncludedHeader} · {included.length}
          </div>
          <div className="import-file-list" data-testid="import-included-list">
            {included.map((f) => (
              <div className="import-file-row" key={f.path}>
                <span className="import-file-row__icon" aria-hidden="true">
                  {f.isMd ? <FileText size={14} /> : <ImageIcon size={14} />}
                </span>
                <span className="import-file-row__path">{f.path}</span>
                {f.isMd && f.refs > 0 ? (
                  <span className="import-file-row__tag">
                    {copy.previewRowRefs.replace("{n}", String(f.refs))}
                  </span>
                ) : (
                  <span />
                )}
                <span className="import-file-row__bytes">{formatBytes(f.bytes)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="import-eyebrow import-eyebrow--warn">
            {copy.previewSkippedHeader} · {skippedCount}
          </div>
          <div className="import-file-list" data-testid="import-skipped-list">
            {bundle.skipped.length === 0 ? (
              <div className="import-file-list__footer">{copy.previewSkippedHint}</div>
            ) : (
              <>
                {bundle.skipped.map((s) => (
                  <div
                    className="import-file-row import-file-row--skipped"
                    key={`${s.path}:${s.reason}`}
                  >
                    <span
                      className="import-file-row__icon import-file-row__icon--warn"
                      aria-hidden="true"
                    >
                      <AlertTriangle size={13} />
                    </span>
                    <span className="import-file-row__path">{s.path}</span>
                    <span className="import-file-row__tag import-file-row__tag--amber">
                      {skippedTag(copy, s)}
                    </span>
                  </div>
                ))}
                <div className="import-file-list__footer">{copy.previewSkippedHint}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
