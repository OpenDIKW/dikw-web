// Appearance for the MB-Web variant — adopts the workbench's theme preference
// instead of owning a standalone one.
//
// MB-Web no longer persists its own `dikw-mb.theme`; it reads the same
// `dikw-web.theme` key the workbench Settings appearance panel writes (mirroring
// the unified connection settings — see `mb/connection.ts`), resolving a stored
// `"system"` preference to a concrete light/dark and following live OS changes
// while it stays `"system"` (parity with the workbench). MB-Web keeps a one-tap
// header toggle that commits an explicit light/dark back to that shared key via
// `persistTheme`, so a flip in MB-Web is reflected in the workbench too. The
// toggle never re-selects `"system"` — only the workbench panel does.
import { useCallback, useEffect, useState } from "react";
import {
  isThemePreference,
  resolveTheme,
  themeStorageKey,
  type ResolvedTheme,
  type ThemePreference,
} from "../i18n";

/** Read the shared theme preference, defaulting to `"system"` for a missing or
 *  unrecognized stored value. */
export function loadThemePreference(): ThemePreference {
  const stored = localStorage.getItem(themeStorageKey);
  return isThemePreference(stored) ? stored : "system";
}

/** Commit an explicit light/dark choice to the shared key. */
export function persistTheme(theme: ResolvedTheme): void {
  localStorage.setItem(themeStorageKey, theme);
}

/** MB-Web's appearance state: the resolved theme plus a one-tap toggle.
 *
 *  The effect is **apply-only** — it drives `<html data-theme>` and, while the
 *  preference is `"system"`, follows live `prefers-color-scheme` changes (as the
 *  workbench does in `src/App.tsx`), but it never writes storage. So merely
 *  opening MB-Web (or the OS flipping while it's open) never overwrites the
 *  stored `"system"` preference with its resolved value. Persistence happens
 *  *only* on an explicit toggle, which commits a concrete light/dark to the
 *  shared `dikw-web.theme`. */
export function useSharedTheme(): [ResolvedTheme, () => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = resolveTheme(preference);
      setResolved(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
    };
    apply();
    if (preference !== "system" || !media) return;
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [preference]);

  const toggle = useCallback(() => {
    const next: ResolvedTheme = resolved === "dark" ? "light" : "dark";
    setPreference(next);
    persistTheme(next);
  }, [resolved]);

  return [resolved, toggle];
}
