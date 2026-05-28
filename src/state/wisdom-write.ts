// Persists the *task_id* of an in-flight wisdom write so a page refresh can
// resume polling instead of losing the user's save. Lives in sessionStorage
// (per-tab) and is tagged with the core URL it belongs to, so a Settings
// change can't accidentally resume a stale task against the wrong server.
//
// The draft body itself is NOT persisted — if the user refreshes while a save
// is in flight we still want to come back into a saving UI state (so they
// can see whether the task succeeded), but a refresh without an in-flight
// task simply discards the draft. That matches the import pipeline's
// "uploading is non-resumable" rule for the same reason: the in-flight POST
// died with the page.

export interface WisdomWriteState {
  taskId: string;
  /** Path the save targets — for an *update* this is the existing wisdom
   *  path; for a *create* this is the `__pending__/{slug}` placeholder so
   *  the resumed UI can rebind to the same row. */
  targetPath: string;
  /** Wisdom slug submitted with the task. Used after resume to rebuild a
   *  minimal pending-draft scaffold if the row no longer exists in the
   *  list (e.g. the user refreshed before the create's terminal event). */
  slug: string;
  /** Whether this save also expected to update the row's status (favorite
   *  toggle goes through here with ``no_embed=true``). Purely informational
   *  for the resumed UI message. */
  scope: "edit" | "create" | "favorite";
  /** The core URL this task belongs to. Stamped on save and checked on
   *  load so a Settings change doesn't let us resume against the wrong
   *  server. */
  coreUrl: string;
}

export const WISDOM_WRITE_STORAGE_KEY = "dikw-web.wisdomWrite";

export function loadWisdomWriteState(currentCoreUrl: string): WisdomWriteState | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(WISDOM_WRITE_STORAGE_KEY);
  if (!raw) return null;
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsedUnknown === null || typeof parsedUnknown !== "object") {
    return null;
  }
  const parsed = parsedUnknown as WisdomWriteState;
  if (!parsed.taskId || !parsed.targetPath || !parsed.slug) {
    return null;
  }
  // Cross-core guard — task ids belong to the original server. Resuming
  // against a different core would be a silent cross-server call.
  if (parsed.coreUrl && parsed.coreUrl !== currentCoreUrl) {
    return null;
  }
  return parsed;
}

export function saveWisdomWriteState(state: Omit<WisdomWriteState, "coreUrl">, currentCoreUrl: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(
    WISDOM_WRITE_STORAGE_KEY,
    JSON.stringify({ ...state, coreUrl: currentCoreUrl })
  );
}

export function clearWisdomWriteState(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(WISDOM_WRITE_STORAGE_KEY);
}
