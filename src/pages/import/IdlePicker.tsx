import { useCallback, useRef, useState } from "react";
import { FileText, FolderOpen, Upload } from "lucide-react";
import { Notice } from "../../components/Notice";
import {
  ImportBundleError,
  type ImportBundleResult
} from "../../utils/import-bundle";
import { BundlePreview } from "./BundlePreview";
import { readDroppedItems } from "./readDroppedItems";
import type { ImportCopy } from "./format";

interface IdlePickerProps {
  copy: ImportCopy;
  onFilesChosen: (files: File[]) => void;
  onDropError: (err: unknown) => void;
  bundle: ImportBundleResult | null;
  bundleBuilding: boolean;
  bundleError: unknown;
  onStart: () => void;
  onReset: () => void;
}

export function IdlePicker({
  copy,
  onFilesChosen,
  onDropError,
  bundle,
  bundleBuilding,
  bundleError,
  onStart,
  onReset
}: IdlePickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire per child element — counting them keeps the
  // "is-dragging" class from flickering as the cursor moves over the icon
  // and copy children inside the dropzone.
  const dragDepth = useRef(0);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      // Don't make the React event handler itself async — an unhandled
      // rejection from readDroppedItems (permission errors, Safari quirks)
      // would otherwise vanish into the synthetic-event system. Materialize
      // the promise here, route failures into the bundleError pipeline so
      // the existing Notice surfaces them.
      readDroppedItems(event.dataTransfer).then(
        (files) => {
          if (files.length > 0) onFilesChosen(files);
        },
        (err) => {
          onDropError(err);
        }
      );
    },
    [onFilesChosen, onDropError]
  );

  return (
    <>
      <section
        className={`panel import-panel-flush${dragging ? " is-dragging" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        data-testid="import-dropzone"
      >
        <div className={`import-dropzone${dragging ? " is-dragging" : ""}`}>
          <div className="import-dropzone__icon" aria-hidden="true">
            <Upload size={24} />
          </div>
          <div className="import-dropzone__copy">
            <div className="import-dropzone__title">{copy.pickerTitle}</div>
            <div className="import-dropzone__hint">{copy.pickerHint}</div>
          </div>
          <div className="import-dropzone__actions">
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
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf"
          className="import-input-hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (!list) return;
            onFilesChosen(Array.from(list));
            // Reset so picking the same file twice re-fires onChange.
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
          className="import-input-hidden"
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
        <BundlePreview
          copy={copy}
          bundle={bundle}
          onStart={onStart}
          onReset={onReset}
        />
      ) : null}
    </>
  );
}
