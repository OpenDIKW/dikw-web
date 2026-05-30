// Drag-and-drop handler for the Import dropzone. Files-only: directory drops
// are ignored (the picker no longer supports folder upload), and the caller is
// told a folder was skipped so it can surface a hint.

export interface DroppedItems {
  files: File[];
  /** True when at least one dropped entry was a directory (ignored). */
  skippedDirectory: boolean;
}

/** Read a DataTransfer from a drop event into a flat ``File[]``, skipping any
 *  dropped directories. */
export async function readDroppedItems(dt: DataTransfer): Promise<DroppedItems> {
  if (!dt.items || dt.items.length === 0) {
    return { files: Array.from(dt.files ?? []), skippedDirectory: false };
  }
  const files: File[] = [];
  let skippedDirectory = false;
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    // ``webkitGetAsEntry`` is Chrome/Safari/FF on https. Fall back to getAsFile.
    const anyItem = item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
    };
    const entry = anyItem.webkitGetAsEntry?.() ?? null;
    if (entry && entry.isDirectory) {
      skippedDirectory = true;
      continue;
    }
    const f = item.getAsFile();
    if (f) files.push(f);
  }
  return { files, skippedDirectory };
}
