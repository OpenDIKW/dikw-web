import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Node 25 exposes a global `localStorage` / `sessionStorage` that isn't a working
// Web Storage (its methods aren't functions / need a backing file), so the moment
// a component under test touches it the whole suite throws. Install a tiny
// in-memory Storage when the present one is unusable, so tests run on any Node.
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (current && typeof current.getItem === "function" && typeof current.clear === "function") {
    return;
  }
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage() as unknown as Storage,
    configurable: true,
    writable: true,
  });
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Node 25 exposes an experimental global `localStorage`/`sessionStorage` whose
  // `clear()` isn't always a function; guard so the afterEach hook doesn't throw
  // and red the whole suite under newer Node.
  if (typeof sessionStorage !== "undefined" && typeof sessionStorage.clear === "function") {
    sessionStorage.clear();
  }
  if (typeof localStorage !== "undefined" && typeof localStorage.clear === "function") {
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
