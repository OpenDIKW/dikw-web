import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncResource } from "./useAsyncResource";

describe("useAsyncResource", () => {
  it("loads data and reloads through the public hook API", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const { result } = renderHook(() => useAsyncResource(load, []));

    await waitFor(() => expect(result.current.data).toBe("first"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("second"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports load errors", async () => {
    const load = vi.fn().mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useAsyncResource(load, []));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.loading).toBe(false);
  });

  it("aborts the in-flight request on unmount", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((nextSignal: AbortSignal) => {
      signals.push(nextSignal);
      return new Promise<string>(() => undefined);
    });

    const { unmount } = renderHook(() => useAsyncResource(load, []));
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });
});
