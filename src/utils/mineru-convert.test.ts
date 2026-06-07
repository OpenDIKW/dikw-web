// @vitest-environment node
//
// Browser-side convertSource + convertedToFiles tests. Stubs the /web/mineru
// endpoint via an injected fetch and uses MemoryConvertCache. We run under
// Node (not jsdom) because jsdom lacks DecompressionStream + a working
// Blob.stream(); Node's globals match the actual production browser path.

import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { buildTar } from "./tar";
import { computeProjectRelPath, scanFiles } from "./import-bundle";
import {
  CACHE_TTL_MS,
  convertedToFiles,
  convertSource,
  IDBConvertCache,
  isCacheEntryExpired,
  MemoryConvertCache,
  MINERU_EXTENSIONS,
} from "./mineru-convert";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeTarGzResponse(
  stem: string,
  markdown: string,
  assets: Array<[string, Uint8Array]>,
): Response {
  const entries = [{ archivePath: `${stem}.md`, data: enc(markdown) }];
  const sortedAssets = [...assets].sort(([a], [b]) => a.localeCompare(b));
  for (const [path, data] of sortedAssets) {
    entries.push({ archivePath: path, data });
  }
  const tar = buildTar(entries);
  const gz = gzipSync(Buffer.from(tar));
  const arrayBuf = new ArrayBuffer(gz.byteLength);
  new Uint8Array(arrayBuf).set(gz);
  return new Response(new Blob([arrayBuf]), {
    status: 200,
    headers: { "Content-Type": "application/x-tar+gzip" },
  });
}

type PollScript =
  | { kind: "status"; status: string; error?: { code: string; message: string } }
  | { kind: "http"; httpStatus: number; body?: unknown }
  | { kind: "throw" };

/** Scripts the submit → poll → result endpoints behind one fetch double (#60).
 *  Defaults to a one-poll happy path returning a tar.gz result. */
function makeScriptedFetch(
  opts: {
    jobId?: string;
    stem?: string;
    markdown?: string;
    assets?: Array<[string, Uint8Array]>;
    pollStatuses?: PollScript[];
    submit?: { httpStatus: number; body?: unknown };
    result?: { httpStatus: number; contentType?: string; body?: BodyInit };
  } = {},
): { fetchFn: typeof fetch; urls: string[] } {
  const jobId = opts.jobId ?? "job-1";
  const pollStatuses = opts.pollStatuses ?? [{ kind: "status", status: "succeeded" }];
  const urls: string[] = [];
  let pollIdx = 0;
  const fetchFn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    urls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/web/mineru/convert")) {
      const s = opts.submit ?? { httpStatus: 202, body: { jobId, status: "pending" } };
      return new Response(JSON.stringify(s.body ?? {}), {
        status: s.httpStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/cancel")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/result")) {
      if (opts.result) {
        return new Response(opts.result.body ?? "", {
          status: opts.result.httpStatus,
          headers: opts.result.contentType ? { "Content-Type": opts.result.contentType } : {},
        });
      }
      return makeTarGzResponse(opts.stem ?? "doc", opts.markdown ?? "# Body\n", opts.assets ?? []);
    }
    if (url.includes("/web/mineru/jobs/")) {
      const entry = pollStatuses[Math.min(pollIdx, pollStatuses.length - 1)];
      pollIdx += 1;
      if (entry.kind === "throw") throw new TypeError("network glitch");
      if (entry.kind === "http") {
        return new Response(JSON.stringify(entry.body ?? {}), {
          status: entry.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body: Record<string, unknown> = { jobId, status: entry.status };
      if (entry.error) body.error = entry.error;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

describe("MINERU_EXTENSIONS", () => {
  it("covers the 7 documented input formats", () => {
    expect(Array.from(MINERU_EXTENSIONS).sort()).toEqual([
      ".doc",
      ".docx",
      ".pdf",
      ".ppt",
      ".pptx",
      ".xls",
      ".xlsx",
    ]);
  });
});

describe("convertSource", () => {
  it("submits, polls, then fetches the result tar.gz", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "test.pdf", {
      type: "application/pdf",
    });
    const { fetchFn, urls } = makeScriptedFetch({
      stem: "test",
      markdown: "---\nsource:\n  converter: mineru\n---\n# Body\n",
      assets: [["assets/images/fig.png", new Uint8Array([0xff, 0xd8])]],
    });
    const c = await convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 });
    expect(c.stem).toBe("test");
    expect(c.markdown).toContain("# Body");
    expect(c.assets.size).toBe(1);
    expect(Array.from(c.assets.get("assets/images/fig.png")!)).toEqual([0xff, 0xd8]);
    // The first request is the submit; the flow then polls and fetches /result.
    expect(urls[0]).toContain("POST /web/mineru/convert?inputSha=");
    expect(urls.some((u) => u.startsWith("GET /web/mineru/jobs/") && !u.endsWith("/result"))).toBe(
      true,
    );
    expect(urls.some((u) => u.endsWith("/result"))).toBe(true);
  });

  it("emits a polling progress event between upload and download", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({ stem: "x", markdown: "# X\n" });
    const phases: string[] = [];
    await convertSource(file, {
      fetch: fetchFn,
      pollIntervalMs: 1,
      onProgress: (e) => phases.push(e.phase),
    });
    expect(phases).toContain("polling");
    expect(phases.indexOf("uploading")).toBeLessThan(phases.indexOf("polling"));
    expect(phases.indexOf("polling")).toBeLessThan(phases.indexOf("downloading"));
  });

  it("appends the originalFilename query to the submit, omits it otherwise", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "short.pdf", {
      type: "application/pdf",
    });
    const withName = makeScriptedFetch({ stem: "short" });
    await convertSource(file, {
      fetch: withName.fetchFn,
      pollIntervalMs: 1,
      originalFilename: "真实的非常长的原始文件名.pdf",
    });
    const submit1 = withName.urls.find((u) => u.includes("/web/mineru/convert"));
    expect(submit1).toContain(
      `originalFilename=${encodeURIComponent("真实的非常长的原始文件名.pdf")}`,
    );

    const without = makeScriptedFetch({ stem: "short" });
    await convertSource(file, { fetch: without.fetchFn, pollIntervalMs: 1 });
    const submit2 = without.urls.find((u) => u.includes("/web/mineru/convert"));
    expect(submit2).not.toContain("originalFilename=");
  });

  it("hits the cache on the second call (no further fetches)", async () => {
    const file = new File([new Uint8Array([5, 6, 7])], "x.docx");
    const { fetchFn, urls } = makeScriptedFetch({ stem: "x", markdown: "# X\n" });
    const cache = new MemoryConvertCache();
    await convertSource(file, { fetch: fetchFn, cache, pollIntervalMs: 1 });
    const afterFirst = urls.length;
    expect(afterFirst).toBeGreaterThan(0);
    const second = await convertSource(file, { fetch: fetchFn, cache, pollIntervalMs: 1 });
    expect(urls.length).toBe(afterFirst); // cache hit → no new requests
    expect(second.markdown).toContain("X");
  });

  it("maps the submit JSON error envelope to MineruConvertError.code", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({
      submit: { httpStatus: 429, body: { error: { code: "mineru_quota", message: "quota" } } },
    });
    await expect(convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 })).rejects.toMatchObject({
      name: "MineruConvertError",
      code: "mineru_quota",
    });
  });

  it("maps 503 mineru_disabled on submit when the sidecar lacks a key", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({
      submit: { httpStatus: 503, body: { error: { code: "mineru_disabled", message: "no key" } } },
    });
    await expect(convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 })).rejects.toMatchObject({
      code: "mineru_disabled",
    });
  });

  it("surfaces a failed job's error code from the poll status", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({
      pollStatuses: [
        {
          kind: "status",
          status: "failed",
          error: { code: "mineru_quota", message: "Daily quota exceeded" },
        },
      ],
    });
    await expect(convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 })).rejects.toMatchObject({
      code: "mineru_quota",
      message: "Daily quota exceeded",
    });
  });

  it("throws mineru_api when the job is gone (404 on poll)", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({
      pollStatuses: [
        { kind: "http", httpStatus: 404, body: { error: { code: "not_found", message: "gone" } } },
      ],
    });
    await expect(convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 })).rejects.toMatchObject({
      code: "mineru_api",
    });
  });

  it("retries a transient poll failure, then succeeds", async () => {
    const file = new File([new Uint8Array([1, 2])], "x.pdf");
    const { fetchFn, urls } = makeScriptedFetch({
      stem: "x",
      markdown: "# X\n",
      pollStatuses: [
        { kind: "throw" },
        { kind: "http", httpStatus: 503 },
        { kind: "status", status: "running" },
        { kind: "status", status: "succeeded" },
      ],
    });
    const c = await convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 });
    expect(c.markdown).toContain("# X");
    const polls = urls.filter(
      (u) => u.startsWith("GET /web/mineru/jobs/") && !u.endsWith("/result"),
    );
    expect(polls.length).toBeGreaterThanOrEqual(4);
  });

  it("throws aborted when the signal fires before any fetch", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(
      convertSource(file, { fetch: fetchFn, signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("aborts mid-poll: posts cancel and throws aborted", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.pdf");
    const ctrl = new AbortController();
    const urls: string[] = [];
    const fetchFn = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/web/mineru/convert")) {
        return new Response(JSON.stringify({ jobId: "job-1", status: "pending" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/cancel")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/web/mineru/jobs/")) {
        // Abort during the poll so the following inter-poll delay rejects at once.
        ctrl.abort();
        return new Response(JSON.stringify({ jobId: "job-1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;
    await expect(
      convertSource(file, { fetch: fetchFn, signal: ctrl.signal, pollIntervalMs: 50 }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(urls.some((u) => u.startsWith("POST") && u.endsWith("/cancel"))).toBe(true);
  });

  it("retries a transient result-fetch failure, then returns the tar.gz", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.pdf");
    let resultCalls = 0;
    const fetchFn = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/web/mineru/convert")) {
        return new Response(JSON.stringify({ jobId: "job-1", status: "pending" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/result")) {
        resultCalls += 1;
        if (resultCalls === 1) return new Response("boom", { status: 503 });
        return makeTarGzResponse("x", "# X\n", []);
      }
      if (url.includes("/web/mineru/jobs/")) {
        return new Response(JSON.stringify({ jobId: "job-1", status: "succeeded" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;
    const c = await convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 });
    expect(c.markdown).toContain("# X");
    expect(resultCalls).toBe(2); // 503, then success
  });

  it("rejects an unexpected result content-type as invalid_response", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const { fetchFn } = makeScriptedFetch({
      result: { httpStatus: 200, contentType: "text/plain", body: "not a tar" },
    });
    await expect(convertSource(file, { fetch: fetchFn, pollIntervalMs: 1 })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("returns byte-stable result for identical input (same file → same markdown + same asset bytes)", async () => {
    // Same input file bytes, but separate File objects (and separate fetch
    // mocks) — output must be deterministic byte-for-byte.
    const bytes = new Uint8Array([10, 11, 12, 13]);
    const fileA = new File([new Uint8Array(bytes)], "doc.pdf");
    const fileB = new File([new Uint8Array(bytes)], "doc.pdf");
    const mk = () =>
      makeScriptedFetch({
        stem: "doc",
        markdown: "---\nsource:\n  converter: mineru\n---\n# X\n",
        assets: [["assets/img.png", new Uint8Array([0xff, 0xd8, 0xff])]],
      }).fetchFn;
    const a = await convertSource(fileA, { fetch: mk(), pollIntervalMs: 1 });
    const b = await convertSource(fileB, { fetch: mk(), pollIntervalMs: 1 });
    expect(a.markdown).toBe(b.markdown);
    expect(a.inputSha).toBe(b.inputSha);
    expect(Array.from(a.assets.keys())).toEqual(Array.from(b.assets.keys()));
    for (const k of a.assets.keys()) {
      expect(Array.from(a.assets.get(k)!)).toEqual(Array.from(b.assets.get(k)!));
    }
  });
});

describe("convertedToFiles", () => {
  it("produces File[] whose webkitRelativePath survives scanFiles strip-prefix", () => {
    const c = {
      input: new File([new Uint8Array(0)], "test.pdf"),
      inputSha: "deadbeefcafe1234",
      stem: "test",
      markdown: "# Body\n",
      assets: new Map([["assets/images/fig.png", new Uint8Array([1, 2])]]),
    };
    const files = convertedToFiles(c);
    // Synthetic root now suffixes the stem with the first 12 chars of
    // inputSha to keep two same-stem inputs from colliding into a
    // duplicate_path skip. Same bytes → same suffix → idempotency holds.
    const root = "test-deadbeefcafe";
    expect(files.map((f) => computeProjectRelPath(f)).sort()).toEqual([
      `${root}/assets/images/fig.png`,
      `${root}/test.md`,
    ]);
    const scan = scanFiles(files);
    expect(scan.mdPaths).toEqual([`${root}/test.md`]);
    expect(scan.skipped).toEqual([]);
  });

  it("uses a different synthetic root for same-stem inputs with different content", () => {
    const a = {
      input: new File([new Uint8Array(0)], "report.pdf"),
      inputSha: "aaaaaaaaaaaaaaaaaaaaaaaa",
      stem: "report",
      markdown: "# A\n",
      assets: new Map<string, Uint8Array>(),
    };
    const b = { ...a, inputSha: "bbbbbbbbbbbbbbbbbbbbbbbb" };
    const aFiles = convertedToFiles(a);
    const bFiles = convertedToFiles(b);
    const aPath = computeProjectRelPath(aFiles[0]);
    const bPath = computeProjectRelPath(bFiles[0]);
    expect(aPath).not.toBe(bPath);
    expect(aPath.startsWith("report-aaa")).toBe(true);
    expect(bPath.startsWith("report-bbb")).toBe(true);
  });

  it("sorts assets so iteration order doesn't perturb downstream bundle sha", () => {
    const c1 = {
      input: new File([new Uint8Array(0)], "x.pdf"),
      inputSha: "a",
      stem: "x",
      markdown: "# X\n",
      assets: new Map([
        ["assets/b.png", new Uint8Array([2])],
        ["assets/a.png", new Uint8Array([1])],
      ]),
    };
    const c2 = {
      input: c1.input,
      inputSha: c1.inputSha,
      stem: c1.stem,
      markdown: c1.markdown,
      assets: new Map([
        ["assets/a.png", new Uint8Array([1])],
        ["assets/b.png", new Uint8Array([2])],
      ]),
    };
    const paths1 = convertedToFiles(c1).map((f) => f.webkitRelativePath);
    const paths2 = convertedToFiles(c2).map((f) => f.webkitRelativePath);
    expect(paths1).toEqual(paths2);
  });
});

// Minimal IndexedDB cursor double: faithfully re-fires the openCursor request's
// onsuccess for each entry (and once more with a null cursor at the end),
// supports cursor.delete(), and fires the transaction's oncomplete once the
// cursor terminates — enough to exercise IDBConvertCache.sweepExpired (which
// resolves on tx.oncomplete) without a full fake-indexeddb dependency.
function makeFakeIdb(initial: Array<[string, unknown]>): {
  db: IDBDatabase;
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(initial);
  const tx: {
    objectStore: (name: string) => unknown;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
  } = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
  const store = {
    openCursor() {
      const req: {
        result: unknown;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        error: unknown;
      } = { result: null, onsuccess: null, onerror: null, error: null };
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
          primaryKey: key,
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
  const db = { transaction: (_name: string, _mode: string) => tx };
  return { db: db as unknown as IDBDatabase, data };
}

describe("cache TTL cleanup", () => {
  const NOW = 1_700_000_000_000;

  describe("isCacheEntryExpired", () => {
    it("keeps a fresh entry", () => {
      expect(isCacheEntryExpired(NOW - 1000, NOW)).toBe(false);
    });
    it("keeps an entry exactly at the TTL boundary (not strictly older)", () => {
      expect(isCacheEntryExpired(NOW - CACHE_TTL_MS, NOW)).toBe(false);
    });
    it("expires an entry one ms past the TTL", () => {
      expect(isCacheEntryExpired(NOW - CACHE_TTL_MS - 1, NOW)).toBe(true);
    });
    it("treats a missing or non-numeric cachedAt as expired", () => {
      expect(isCacheEntryExpired(undefined, NOW)).toBe(true);
      expect(isCacheEntryExpired(Number.NaN, NOW)).toBe(true);
      expect(isCacheEntryExpired("oops" as unknown, NOW)).toBe(true);
    });
    it("keeps a future-dated entry (tolerates clock skew)", () => {
      expect(isCacheEntryExpired(NOW + 5000, NOW)).toBe(false);
    });
  });

  describe("IDBConvertCache.sweepExpired", () => {
    const rec = (cachedAt?: number): Record<string, unknown> => ({
      mineruVersion: 1,
      stem: "s",
      markdown: "# s\n",
      assets: [],
      ...(cachedAt === undefined ? {} : { cachedAt }),
    });

    it("deletes only entries strictly older than 7 days", async () => {
      const { db, data } = makeFakeIdb([
        ["fresh", rec(NOW - 1000)],
        ["boundary", rec(NOW - CACHE_TTL_MS)],
        ["stale", rec(NOW - CACHE_TTL_MS - 1)],
        ["ancient", rec(NOW - 30 * CACHE_TTL_MS)],
      ]);
      const cache = new IDBConvertCache(db);
      await cache.sweepExpired(NOW);
      expect([...data.keys()].sort()).toEqual(["boundary", "fresh"]);
    });

    it("deletes a legacy record with no cachedAt", async () => {
      const { db, data } = makeFakeIdb([
        ["legacy", rec(undefined)],
        ["fresh", rec(NOW)],
      ]);
      const cache = new IDBConvertCache(db);
      await cache.sweepExpired(NOW);
      expect([...data.keys()]).toEqual(["fresh"]);
    });

    it("resolves without deleting anything when the store is empty", async () => {
      const { db, data } = makeFakeIdb([]);
      const cache = new IDBConvertCache(db);
      await cache.sweepExpired(NOW);
      expect(data.size).toBe(0);
    });
  });
});
