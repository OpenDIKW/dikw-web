import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The application owns the storage key. OS changes never persist a resolved preference. */
export function useTheme({ storageKey }: { storageKey: string }) {
  const [preference, updatePreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem(storageKey);
    return isThemePreference(stored) ? stored : "system";
  });
  const [resolved, setResolved] = useState(() => resolveTheme(preference));
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
  const setPreference = useCallback(
    (next: ThemePreference) => {
      localStorage.setItem(storageKey, next);
      updatePreference(next);
    },
    [storageKey],
  );
  return { preference, resolved, setPreference };
}
