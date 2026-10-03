import { expect, it, vi } from "vitest";
import { tryOpenDefaultCache } from "@opendikw/web-client/convert";
import { tryOpenDefaultTranslateCache } from "@opendikw/web-client/translate";

it.each([
  ["conversion", tryOpenDefaultCache, "dikw-mineru-cache"],
  ["translation", tryOpenDefaultTranslateCache, "dikw-translate-cache"],
])(
  "opens separate %s caches while keeping the existing default",
  async (_name, openCache, legacyName) => {
    const open = vi.fn((_name: string, _version?: number) => {
      const request = { onerror: null as (() => void) | null };
      queueMicrotask(() => request.onerror?.());
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    await openCache();
    await openCache({ namespace: "account-a-core-1" });
    await openCache({ namespace: "account-b-core-1" });
    expect(open.mock.calls.map(([name]) => name)).toEqual([
      legacyName,
      `${legacyName}:account-a-core-1`,
      `${legacyName}:account-b-core-1`,
    ]);
  },
);
