import { describe, expect, it } from "vitest";
import {
  fetchTranslateEnabled,
  IDBTranslateCache,
  MemoryTranslateCache,
  TranslateError,
  translateBlocks,
} from "./translate";
import { CACHE_TTL_MS } from "./mineru-convert";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ScriptOptions {
  /** status sequence returned by the job poll; defaults to ["succeeded"]. */
  pollStatuses?: string[];
  /** error object returned alongside a "failed" poll status. */
  failError?: { code: string; message: string };
}

function makeScriptedFetch(
  translations: Array<{ i: number; tr: string }>,
  opts: ScriptOptions = {},
): { fetchFn: typeof fetch; urls: string[]; submittedBlocks: string[][] } {
  const urls: string[] = [];
  const submittedBlocks: string[][] = [];
  const pollStatuses = opts.pollStatuses ?? ["succeeded"];
  let pollIdx = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    urls.push(`${method} ${url}`);
    if (url === "/web/translate/submit") {
      submittedBlocks.push(JSON.parse(String(init?.body)).blocks);
      return jsonResponse({ jobId: "job-1", status: "pending" }, 202);
    }
    if (url === "/web/translate/jobs/job-1") {
      const status = pollStatuses[Math.min(pollIdx, pollStatuses.length - 1)];
      pollIdx += 1;
      const body: Record<string, unknown> = { jobId: "job-1", status };
      if (status === "failed" && opts.failError) body.error = opts.failError;
      return jsonResponse(body);
    }
    if (url === "/web/translate/jobs/job-1/result") {
      return jsonResponse({ blocks: translations });
    }
    if (url === "/web/translate/jobs/job-1/cancel") {
      return jsonResponse({ jobId: "job-1", ok: true });
    }
    return jsonResponse({ error: { code: "not_found" } }, 404);
  }) as unknown as typeof fetch;
  return { fetchFn, urls, submittedBlocks };
}

describe("translateBlocks", () => {
  it("submits, polls, then aligns the result 1:1 by index", async () => {
    const { fetchFn, urls, submittedBlocks } = makeScriptedFetch(
      // deliberately out of order to prove index alignment
      [
        { i: 1, tr: "世界" },
        { i: 0, tr: "你好" },
      ],
      { pollStatuses: ["running", "succeeded"] },
    );
    const out = await translateBlocks(["Hello", "World"], {
      fetch: fetchFn,
      pollIntervalMs: 1,
    });
    expect(out).toEqual(["你好", "世界"]);
    expect(submittedBlocks[0]).toEqual(["Hello", "World"]);
    expect(urls.some((u) => u.startsWith("POST /web/translate/submit"))).toBe(true);
    expect(urls.some((u) => u === "GET /web/translate/jobs/job-1/result")).toBe(true);
  });

  it("returns early on a cache hit without any network call", async () => {
    const { fetchFn, urls } = makeScriptedFetch([{ i: 0, tr: "你好" }]);
    const cache = new MemoryTranslateCache();
    await translateBlocks(["Hello"], { fetch: fetchFn, cache, pollIntervalMs: 1 });
    const afterFirst = urls.length;
    expect(afterFirst).toBeGreaterThan(0);
    const second = await translateBlocks(["Hello"], { fetch: fetchFn, cache, pollIntervalMs: 1 });
    expect(second).toEqual(["你好"]);
    expect(urls.length).toBe(afterFirst); // cache hit → no new requests
  });

  it("surfaces the wire error code from a failed job", async () => {
    const { fetchFn } = makeScriptedFetch([], {
      pollStatuses: ["failed"],
      failError: { code: "translator_auth", message: "bad key" },
    });
    await expect(
      translateBlocks(["a"], { fetch: fetchFn, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ code: "translator_auth" });
  });

  it("maps a 503 submit to translate_disabled", async () => {
    const fetchFn = (async () =>
      jsonResponse({ error: { code: "translate_disabled" } }, 503)) as unknown as typeof fetch;
    await expect(
      translateBlocks(["a"], { fetch: fetchFn, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ code: "translate_disabled" });
  });

  it("throws aborted when the signal is already aborted", async () => {
    const { fetchFn } = makeScriptedFetch([{ i: 0, tr: "x" }]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      translateBlocks(["a"], { fetch: fetchFn, signal: ctrl.signal, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(TranslateError);
  });

  it("returns [] for empty input without a network call", async () => {
    const { fetchFn, urls } = makeScriptedFetch([]);
    expect(await translateBlocks([], { fetch: fetchFn })).toEqual([]);
    expect(urls).toEqual([]);
  });

  it("aborts mid-poll: posts cancel and throws aborted", async () => {
    const ctrl = new AbortController();
    const urls: string[] = [];
    let polls = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/web/translate/submit") {
        return jsonResponse({ jobId: "job-1", status: "pending" }, 202);
      }
      if (url === "/web/translate/jobs/job-1") {
        polls += 1;
        if (polls === 1) ctrl.abort(); // abort while the job is still running
        return jsonResponse({ jobId: "job-1", status: "running" });
      }
      if (url === "/web/translate/jobs/job-1/cancel") {
        return jsonResponse({ jobId: "job-1", ok: true });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }) as unknown as typeof fetch;
    await expect(
      translateBlocks(["a"], { fetch: fetchFn, signal: ctrl.signal, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(urls.some((u) => u === "POST /web/translate/jobs/job-1/cancel")).toBe(true);
  });
});

describe("fetchTranslateEnabled", () => {
  it("reads the health flag", async () => {
    const on = (async () => jsonResponse({ enabled: true })) as unknown as typeof fetch;
    const off = (async () => jsonResponse({ enabled: false })) as unknown as typeof fetch;
    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchTranslateEnabled(on)).toBe(true);
    expect(await fetchTranslateEnabled(off)).toBe(false);
    expect(await fetchTranslateEnabled(boom)).toBe(false);
  });
});

// Minimal IndexedDB double: supports get/put (txGet/txPut) and an openCursor
// that re-fires onsuccess per entry then null + tx.oncomplete (sweepExpired) —
// enough to exercise IDBTranslateCache without a fake-indexeddb dependency,
// mirroring the shim in mineru-convert.test.ts.
function makeFakeIdb(initial: Array<[string, unknown]>): {
  db: IDBDatabase;
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(initial);
  const store = {
    get(key: string) {
      const req: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } =
        {
          result: undefined,
          onsuccess: null,
          onerror: null,
        };
      queueMicrotask(() => {
        req.result = data.get(key);
        req.onsuccess?.();
      });
      return req;
    },
    put(value: unknown, key: string) {
      const req: { onsuccess: (() => void) | null; onerror: (() => void) | null } = {
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        data.set(key, value);
        req.onsuccess?.();
      });
      return req;
    },
    openCursor() {
      const req: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } =
        {
          result: null,
          onsuccess: null,
          onerror: null,
        };
      const keys = [...data.keys()];
      let i = 0;
      const fire = () => {
        if (i >= keys.length) {
          req.result = null;
          req.onsuccess?.();
          queueMicrotask(() => tx.oncomplete?.());
          return;
        }
        const key = keys[i];
        req.result = {
          value: data.get(key),
          continue() {
            i += 1;
            queueMicrotask(fire);
          },
          delete() {
            data.delete(key);
            return { onsuccess: null, onerror: null };
          },
        };
        req.onsuccess?.();
      };
      queueMicrotask(fire);
      return req;
    },
  };
  const tx: {
    objectStore: () => unknown;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
  } = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
  const db = { transaction: (_name: string, _mode: string) => tx };
  return { db: db as unknown as IDBDatabase, data };
}

describe("IDBTranslateCache", () => {
  const NOW = 1_700_000_000_000;
  const rec = (
    over: Partial<{ translateVersion: number; translations: string[]; cachedAt: number }> = {},
  ) => ({ translateVersion: 1, translations: ["你好"], cachedAt: NOW, ...over });

  it("get returns the translations for a fresh, matching-version entry", async () => {
    const { db } = makeFakeIdb([["k", rec({ cachedAt: Date.now() })]]);
    expect(await new IDBTranslateCache(db).get("k")).toEqual(["你好"]);
  });

  it("get returns null on a version mismatch", async () => {
    const { db } = makeFakeIdb([["k", rec({ translateVersion: 999, cachedAt: Date.now() })]]);
    expect(await new IDBTranslateCache(db).get("k")).toBeNull();
  });

  it("get returns null on an expired entry", async () => {
    const { db } = makeFakeIdb([["k", rec({ cachedAt: Date.now() - CACHE_TTL_MS - 1000 })]]);
    expect(await new IDBTranslateCache(db).get("k")).toBeNull();
  });

  it("sweepExpired deletes only entries strictly older than the TTL", async () => {
    const { db, data } = makeFakeIdb([
      ["fresh", rec({ cachedAt: NOW - 1000 })],
      ["boundary", rec({ cachedAt: NOW - CACHE_TTL_MS })],
      ["stale", rec({ cachedAt: NOW - CACHE_TTL_MS - 1 })],
      ["legacy", rec({ cachedAt: undefined as unknown as number })],
    ]);
    await new IDBTranslateCache(db).sweepExpired(NOW);
    expect([...data.keys()].sort()).toEqual(["boundary", "fresh"]);
  });
});
