import { afterEach, expect, it, vi } from "vitest";
import { downloadLegacyMbData } from "./legacyMbExport";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the downloaded blob readable when navigation resolves in a later task", () => {
  vi.useFakeTimers();
  const active = new Set<string>();
  const create = vi.fn(() => {
    active.add("blob:deferred");
    return "blob:deferred";
  });
  const revoke = vi.fn((url: string) => active.delete(url));
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: revoke,
    }),
  );
  const download = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const url = this.href;
    setTimeout(() => download(active.has(url)), 0);
  });
  downloadLegacyMbData();
  expect(active.has("blob:deferred")).toBe(true);
  vi.advanceTimersByTime(0);
  expect(download).toHaveBeenCalledWith(true);
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:deferred");
  expect(active.size).toBe(0);
});
