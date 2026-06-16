// Appearance for the MB-Web variant — adopts the workbench's theme preference
// instead of owning a standalone one.
//
// MB-Web no longer persists its own `dikw-mb.theme`; it reads the same
// `dikw-web.theme` key the workbench Settings appearance panel writes (mirroring
// the unified connection settings — see `mb/connection.ts`), resolving a stored
// `"system"` preference to a concrete light/dark. MB-Web keeps a one-tap header
// toggle that commits an explicit light/dark back to that shared key via
// `persistTheme`, so a flip in MB-Web is reflected in the workbench too. The
// toggle never re-selects `"system"` — only the workbench panel does.
import { useCallback, useEffect, useState } from "react";
import { isThemePreference, resolveTheme, themeStorageKey, type ResolvedTheme } from "../i18n";

/** Read the shared preference and resolve it to the concrete theme to apply.
 *  Falls back to `"system"` for a missing or unrecognized stored value. */
export function loadResolvedTheme(): ResolvedTheme {
  const stored = localStorage.getItem(themeStorageKey);
  return resolveTheme(isThemePreference(stored) ? stored : "system");
}

/** Commit an explicit light/dark choice to the shared key. */
export function persistTheme(theme: ResolvedTheme): void {
  localStorage.setItem(themeStorageKey, theme);
}

/** MB-Web's appearance state: the resolved theme plus a one-tap toggle.
 *
 *  The effect is **apply-only** — it drives `<html data-theme>` but never writes
 *  storage, so merely opening MB-Web (which may read a stored `"system"`) never
 *  overwrites that preference with its resolved light/dark. Persistence happens
 *  *only* on an explicit toggle, which commits a concrete light/dark to the
 *  shared `dikw-web.theme`. */
export function useSharedTheme(): [ResolvedTheme, () => void] {
  const [theme, setTheme] = useState<ResolvedTheme>(() => loadResolvedTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: ResolvedTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  }, [theme]);

  return [theme, toggle];
}
