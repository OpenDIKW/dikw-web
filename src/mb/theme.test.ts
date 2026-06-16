import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { loadResolvedTheme, persistTheme, useSharedTheme } from "./theme";
import { themeStorageKey } from "../i18n";

// MB-Web's pre-unification standalone key. The reader must NOT read it and the
// writer must NOT write it — both go through the shared `dikw-web.theme`.
const legacyMbThemeKey = "dikw-mb.theme";

describe("MB-Web theme — shared with the workbench", () => {
  it("reads an explicit light/dark from the shared dikw-web.theme key", () => {
    localStorage.setItem(themeStorageKey, "dark");
    expect(loadResolvedTheme()).toBe("dark");
    localStorage.setItem(themeStorageKey, "light");
    expect(loadResolvedTheme()).toBe("light");
  });

  it("resolves a stored 'system' preference via the prefers-color-scheme media query", () => {
    const mm = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", mm);
    localStorage.setItem(themeStorageKey, "system");
    expect(loadResolvedTheme()).toBe("dark");
    expect(mm).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(loadResolvedTheme()).toBe("light");
  });

  it("falls back to light (no throw) when matchMedia is unavailable", () => {
    // The optional-chaining guard in resolveTheme must survive an environment
    // with no matchMedia (the production short-circuit invariant).
    vi.stubGlobal("matchMedia", undefined);
    localStorage.setItem(themeStorageKey, "system");
    expect(loadResolvedTheme()).toBe("light");
  });

  it("defaults to the system preference when nothing is stored or the value is garbage", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(loadResolvedTheme()).toBe("dark"); // nothing stored → system
    localStorage.setItem(themeStorageKey, "neon");
    expect(loadResolvedTheme()).toBe("dark"); // unknown value → system
  });

  it("no longer reads MB-Web's legacy dikw-mb.theme key", () => {
    localStorage.setItem(legacyMbThemeKey, "dark");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    // dikw-web.theme is unset, so it falls back to the system default (light) —
    // the stale legacy dark value is ignored.
    expect(loadResolvedTheme()).toBe("light");
  });

  it("persists an explicit choice to the shared key, never the legacy MB key", () => {
    persistTheme("dark");
    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(localStorage.getItem(legacyMbThemeKey)).toBeNull();
  });
});

describe("useSharedTheme", () => {
  it("applies the resolved theme to <html> without overwriting a stored 'system' preference", () => {
    localStorage.setItem(themeStorageKey, "system");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true })); // → dark

    const { result } = renderHook(() => useSharedTheme());

    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    // Merely opening MB-Web must NOT clobber "system" with its resolved value.
    expect(localStorage.getItem(themeStorageKey)).toBe("system");
  });

  it("toggle commits an explicit light/dark to the shared key and flips <html>", () => {
    localStorage.setItem(themeStorageKey, "light");

    const { result } = renderHook(() => useSharedTheme());
    expect(result.current[0]).toBe("light");

    act(() => result.current[1]());

    expect(result.current[0]).toBe("dark");
    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(legacyMbThemeKey)).toBeNull();
  });

  it("toggling a resolved 'system' theme writes an explicit value, never 'system'", () => {
    localStorage.setItem(themeStorageKey, "system");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false })); // → light

    const { result } = renderHook(() => useSharedTheme());
    expect(result.current[0]).toBe("light");

    act(() => result.current[1]());

    expect(localStorage.getItem(themeStorageKey)).toBe("dark");
  });
});
