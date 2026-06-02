// Session title parsing/validation utility. Shared by http.ts (request validation)
// and adkSessionStore.ts (rename validation); the session store itself is now the
// ADK-backed AdkSessionStore.

export type SessionTitleParseResult =
  | { ok: true; title: string }
  | { ok: false; reason: "required" | "too_long" };

export function parseSessionTitle(value: unknown): SessionTitleParseResult {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: "required" };
  }
  const title = value.trim();
  if (title.length > 80) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, title };
}

export const SESSION_TITLE_ERROR_MESSAGES: Record<"required" | "too_long", string> = {
  required: "session title is required",
  too_long: "session title is too long"
};

export function validateSessionTitle(value: unknown): string {
  const result = parseSessionTitle(value);
  if (!result.ok) {
    throw new Error(SESSION_TITLE_ERROR_MESSAGES[result.reason]);
  }
  return result.title;
}
