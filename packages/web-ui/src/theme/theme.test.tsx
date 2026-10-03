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
