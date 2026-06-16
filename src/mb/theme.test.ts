import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { loadThemePreference, persistTheme, useSharedTheme } from "./theme";
import { themeStorageKey } from "../i18n";

// MB-Web's pre-unification standalone key. The reader must NOT read it and the
// writer must NOT write it — both go through the shared `dikw-web.theme`.
const legacyMbThemeKey = "dikw-mb.theme";

// A controllable `prefers-color-scheme` mock: lets a test capture the change
// listener, flip the OS value, and emit a change — so the live-following path
// (and its teardown) can be exercised deterministically.
function fakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const fn = vi.fn(() => ({
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
  }));
  return {
    fn,
    set: (next: boolean) => {
      matches = next;
    },
    emit: () => listeners.forEach((cb) => cb()),
    listenerCount: () => listeners.size,
  };
}

describe("loadThemePreference", () => {
  it("returns the stored preference verbatim", () => {
    localStorage.setItem(themeStorageKey, "dark");
    expect(loadThemePreference()).toBe("dark");
    localStorage.setItem(themeStorageKey, "light");
    expect(loadThemePreference()).toBe("light");
    localStorage.setItem(themeStorageKey, "system");
    expect(loadThemePreference()).toBe("system");
  });

  it("defaults to 'system' when nothing is stored or the value is garbage", () => {
    expect(loadThemePreference()).toBe("system"); // nothing stored
    localStorage.setItem(themeStorageKey, "neon");
    expect(loadThemePreference()).toBe("system"); // unknown value
  });

  it("ignores MB-Web's legacy dikw-mb.theme key", () => {
    localStorage.setItem(legacyMbThemeKey, "dark");
    expect(loadThemePreference()).toBe("system"); // dikw-web.theme unset → default
  });
});

describe("persistTheme", () => {
  it("writes the shared key, never the legacy MB key", () => {
    persistTheme("dark");
    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(localStorage.getItem(legacyMbThemeKey)).toBeNull();
  });
});

describe("useSharedTheme", () => {
  it("resolves 'system' and applies it to <html> without overwriting the preference", () => {
    localStorage.setItem(themeStorageKey, "system");
    const mm = fakeMatchMedia(true); // → dark
    vi.stubGlobal("matchMedia", mm.fn);

    const { result } = renderHook(() => useSharedTheme());

    expect(result.current[0]).toBe("dark");
    expect(mm.fn).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    // Merely opening MB-Web must NOT clobber "system" with its resolved value.
    expect(localStorage.getItem(themeStorageKey)).toBe("system");
  });

  it("falls back to light (no throw, no subscribe) when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    localStorage.setItem(themeStorageKey, "system");
    const { result } = renderHook(() => useSharedTheme());
    expect(result.current[0]).toBe("light");
  });

  it("follows live OS scheme changes while the preference is 'system'", () => {
    localStorage.setItem(themeStorageKey, "system");
    const mm = fakeMatchMedia(false); // → light
    vi.stubGlobal("matchMedia", mm.fn);

    const { result } = renderHook(() => useSharedTheme());
    expect(result.current[0]).toBe("light");
    expect(mm.listenerCount()).toBe(1);

    act(() => {
      mm.set(true); // OS flips to dark
      mm.emit();
    });

    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // A live OS change must not persist — the preference stays "system".
    expect(localStorage.getItem(themeStorageKey)).toBe("system");
  });

  it("toggle commits an explicit light/dark to the shared key and stops following the OS", () => {
    localStorage.setItem(themeStorageKey, "system");
    const mm = fakeMatchMedia(false); // → light
    vi.stubGlobal("matchMedia", mm.fn);

    const { result } = renderHook(() => useSharedTheme());
    expect(result.current[0]).toBe("light");

    act(() => result.current[1]()); // toggle light → dark (explicit)

    expect(result.current[0]).toBe("dark");
    expect(localStorage.getItem(themeStorageKey)).toBe("dark"); // explicit, never "system"
    expect(localStorage.getItem(legacyMbThemeKey)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");
    // The "system" listener was torn down once the preference became explicit.
    expect(mm.listenerCount()).toBe(0);

    act(() => {
      mm.set(false); // OS flips back to light
      mm.emit();
    });
    expect(result.current[0]).toBe("dark"); // ignored — no longer following the OS
  });
});
