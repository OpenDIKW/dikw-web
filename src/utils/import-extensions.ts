// Single source of truth for "can this file even be selected for import?",
// shared by the picker's drop + file-input paths. Content-level rejections
// (empty body, missing asset, …) still happen later in buildImportBundle;
// this is only the coarse extension gate applied at selection time.

import { ASSET_EXTENSIONS, MD_EXTENSIONS } from "./import-bundle";
import { MINERU_EXTENSIONS } from "./mineru-convert";

/** True when a file with this (lowercase, dot-prefixed) extension is importable
 *  in the current sidecar configuration. Office formats require mineru. */
export function isSelectableExt(ext: string, mineruEnabled: boolean): boolean {
  if (MD_EXTENSIONS.has(ext) || ASSET_EXTENSIONS.has(ext)) return true;
  return mineruEnabled && MINERU_EXTENSIONS.has(ext);
}
