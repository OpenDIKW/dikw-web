import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.clear();
  }
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  if (typeof document !== "undefined") {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  }
  if (typeof window !== "undefined") {
    window.location.hash = "";
  }
});
