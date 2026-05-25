// Drag-and-drop handler for the Import dropzone. Supports both file drops and
// folder drops (Chrome/Firefox/Safari) by walking ``webkitGetAsEntry``
// directory trees. Dropped files come back with ``webkitRelativePath`` set so
// the bundler's ``scanFiles`` strips the top dir the same way it does for a
// ``<input webkitdirectory>`` selection.

/** Read a DataTransfer from a drop event into a flat ``File[]``. */
export async function readDroppedItems(dt: DataTransfer): Promise<File[]> {
  if (!dt.items || dt.items.length === 0) {
    return Array.from(dt.files ?? []);
  }
  const out: File[] = [];
  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    // ``webkitGetAsEntry`` is Chrome/Safari/FF on https. Fall back to getAsFile.
    const anyItem = item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntry | null;
    };
    const entry = anyItem.webkitGetAsEntry?.() ?? null;
    if (entry && entry.isDirectory) {
      tasks.push(
        walkDirEntry(entry as FileSystemDirectoryEntry, entry.name, out)
      );
    } else {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  await Promise.all(tasks);
  return out;
}

async function walkDirEntry(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  sink: File[]
): Promise<void> {
  const reader = dir.createReader();
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  for (;;) {
    const batch = await readBatch();
    if (batch.length === 0) break;
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        );
        // Inject ``webkitRelativePath`` so ``computeProjectRelPath`` strips
        // the top dir consistently with the picker's path.
        Object.defineProperty(file, "webkitRelativePath", {
          value: `${prefix}/${entry.name}`,
          configurable: true
        });
        sink.push(file);
      } else if (entry.isDirectory) {
        await walkDirEntry(
          entry as FileSystemDirectoryEntry,
          `${prefix}/${entry.name}`,
          sink
        );
      }
    }
  }
}
