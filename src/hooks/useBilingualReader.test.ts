import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBilingualReader } from "./useBilingualReader";
import { TranslateError, type TranslateOptions } from "../utils/translate";

// 3 text blocks + 1 special (code fence) between blocks 2 and 4.
const BODY = "# Title\n\nFirst para.\n\n```js\nx;\n```\n\nSecond para.";

const echo = (suffix = "") =>
  vi.fn(async (blocks: string[]) => blocks.map((_, i) => `tr${i}${suffix}`));

describe("useBilingualReader", () => {
  it("toggles on, translates the text blocks, and maps results back 1:1", async () => {
    const translate = echo();
    const { result } = renderHook(() =>
      useBilingualReader({ body: BODY, enabled: true, translate }),
    );

    expect(result.current.active).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.active).toBe(true);

    await waitFor(() => expect(result.current.translating).toBe(false));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][0]).toEqual(["# Title", "First para.", "Second para."]);

    const blocks = result.current.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["text", "text", "special", "text"]);
    expect(blocks[0].translation).toBe("tr0");
    expect(blocks[1].translation).toBe("tr1");
    expect(blocks[2].translation).toBeUndefined(); // special blocks are never translated
    expect(blocks[3].translation).toBe("tr2");
  });

  it("does not translate when the translator is disabled", () => {
    const translate = echo();
    const { result } = renderHook(() =>
      useBilingualReader({ body: BODY, enabled: false, translate }),
    );
    act(() => result.current.toggle());
    expect(result.current.active).toBe(false);
    expect(translate).not.toHaveBeenCalled();
  });

  it("flags a cache hit so the caller can show the cached chip", async () => {
    const translate = vi.fn(async (blocks: string[], opts?: TranslateOptions) => {
      opts?.onProgress?.({ phase: "cache_hit" });
      return blocks.map(() => "x");
    });
    const { result } = renderHook(() =>
      useBilingualReader({ body: BODY, enabled: true, translate }),
    );
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.translating).toBe(false));
    expect(result.current.cached).toBe(true);
  });

  it("surfaces a translation error and stops the spinner", async () => {
    const translate = vi.fn(async () => {
      throw new TranslateError("translator_rate_limit", "slow down");
    });
    const { result } = renderHook(() =>
      useBilingualReader({ body: BODY, enabled: true, translate }),
    );
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.translating).toBe(false));
    expect(result.current.error?.code).toBe("translator_rate_limit");
  });

  it("toggle off returns to the mono view without re-translating", async () => {
    const translate = echo();
    const { result } = renderHook(() =>
      useBilingualReader({ body: BODY, enabled: true, translate }),
    );
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.translating).toBe(false));

    act(() => result.current.toggle());
    expect(result.current.active).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.active).toBe(true);
    expect(translate).toHaveBeenCalledTimes(1); // cached translations reused
  });

  it("resets to the mono view when the page body changes", async () => {
    const translate = echo();
    const { result, rerender } = renderHook(
      ({ body }) => useBilingualReader({ body, enabled: true, translate }),
      { initialProps: { body: BODY } },
    );
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.translating).toBe(false));
    expect(result.current.active).toBe(true);

    rerender({ body: "A different page entirely." });
    expect(result.current.active).toBe(false);
    expect(result.current.blocks.every((b) => b.translation === undefined)).toBe(true);
  });
});
