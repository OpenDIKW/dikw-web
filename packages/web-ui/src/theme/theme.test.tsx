import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useTheme } from "@opendikw/web-ui/theme";

it("follows the OS without overwriting system and saves only the application's key", () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_name: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_name: string, callback: () => void) => listeners.delete(callback),
  }));
  localStorage.setItem("app-a.theme", "system");
  localStorage.setItem("app-b.theme", "light");
  const { result, unmount } = renderHook(() => useTheme({ storageKey: "app-a.theme" }));
  expect(result.current.preference).toBe("system");
  expect(result.current.resolved).toBe("light");
  act(() => {
    dark = true;
    listeners.forEach((listener) => listener());
  });
  expect(result.current.resolved).toBe("dark");
  expect(localStorage.getItem("app-a.theme")).toBe("system");
  act(() => result.current.setPreference("light"));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("app-a.theme")).toBe("light");
  expect(localStorage.getItem("app-b.theme")).toBe("light");
  unmount();
  expect(listeners.size).toBe(0);
});

it("reloads each application's preference when its storage key changes", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  localStorage.setItem("switch-a.theme", "dark");
  localStorage.setItem("switch-b.theme", "light");
  localStorage.setItem("switch-invalid.theme", "invalid");
  const { result, rerender } = renderHook(({ storageKey }) => useTheme({ storageKey }), {
    initialProps: { storageKey: "switch-a.theme" },
  });
  expect(result.current.resolved).toBe("dark");
  rerender({ storageKey: "switch-b.theme" });
  expect(result.current.preference).toBe("light");
  expect(result.current.resolved).toBe("light");
  act(() => result.current.setPreference("dark"));
  expect(localStorage.getItem("switch-b.theme")).toBe("dark");
  expect(localStorage.getItem("switch-a.theme")).toBe("dark");
  rerender({ storageKey: "switch-invalid.theme" });
  expect(result.current.preference).toBe("system");
  expect(result.current.resolved).toBe("light");
  expect(localStorage.getItem("switch-invalid.theme")).toBe("invalid");
});
