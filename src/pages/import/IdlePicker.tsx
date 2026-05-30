import { useCallback, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { Notice } from "../../components/Notice";
import {
  ImportBundleError,
  lowerExt,
  type ImportBundleResult
} from "../../utils/import-bundle";
import { isSelectableExt } from "../../utils/import-extensions";
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
  /** When true, the picker accepts mineru-convertible office/PDF formats
   *  too. When false (sidecar's /web/mineru/health reports disabled),
   *  the picker falls back to .md + image assets + .pdf-as-asset only. */
  mineruEnabled?: boolean;
}

const NATIVE_ACCEPT = ".md,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf";
const MINERU_ACCEPT =
  ".md,.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx";

export function IdlePicker({
  copy,
  onFilesChosen,
  onDropError,
  bundle,
  bundleBuilding,
  bundleError,
  onStart,
  onReset,
  mineruEnabled = false
}: IdlePickerProps) {
  const accept = mineruEnabled ? MINERU_ACCEPT : NATIVE_ACCEPT;
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Surfaces selection-time hints: unsupported formats filtered out, and
  // (drag path only) a dropped folder that was ignored.
  const [pickerNotice, setPickerNotice] = useState<string[] | null>(null);
  // dragenter/dragleave fire per child element — counting them keeps the
  // "is-dragging" class from flickering as the cursor moves over the icon
  // and copy children inside the dropzone.
  const dragDepth = useRef(0);

  // Single choke point for both the file picker and the drop path: filter to
  // selectable formats, build any hint messages, and forward only the
  // supported files to the bundler.
  const handleChosen = useCallback(
    (rawFiles: File[], skippedDirectory: boolean) => {
      const messages: string[] = [];
      if (skippedDirectory) messages.push(copy.folderNotSupported);
      const supported = rawFiles.filter((f) =>
        isSelectableExt(lowerExt(f.name), mineruEnabled)
      );
      const filtered = rawFiles.length - supported.length;
      if (filtered > 0) {
        messages.push(copy.filteredUnsupported.replace("{n}", String(filtered)));
      }
      setPickerNotice(messages.length > 0 ? messages : null);
      if (supported.length > 0) onFilesChosen(supported);
    },
    [copy, mineruEnabled, onFilesChosen]
  );

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
        ({ files, skippedDirectory }) => {
          handleChosen(files, skippedDirectory);
        },
        (err) => {
          onDropError(err);
        }
      );
    },
    [handleChosen, onDropError]
  );

  const handleReset = useCallback(() => {
    setPickerNotice(null);
    onReset();
  }, [onReset]);

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
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={accept}
          className="import-input-hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (!list) return;
            handleChosen(Array.from(list), false);
            // Reset so picking the same file twice re-fires onChange.
            e.target.value = "";
          }}
          data-testid="import-file-input"
        />
      </section>

      {pickerNotice ? (
        <Notice tone="info">
          {pickerNotice.map((message, i) => (
            <div key={i}>{message}</div>
          ))}
        </Notice>
      ) : null}

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
          onReset={handleReset}
        />
      ) : null}
    </>
  );
}
