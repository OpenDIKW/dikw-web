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
  convertedToFiles,
  convertSource,
  MemoryConvertCache,
  MineruConvertError,
  MINERU_EXTENSIONS
} from "./mineru-convert";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeTarGzResponse(stem: string, markdown: string, assets: Array<[string, Uint8Array]>): Response {
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
    headers: { "Content-Type": "application/x-tar+gzip" }
  });
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
      ".xlsx"
    ]);
  });
});

describe("convertSource", () => {
  it("posts to /web/mineru/convert with inputSha query, decodes tar.gz response", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "test.pdf", {
      type: "application/pdf"
    });
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      expect(url).toContain("/web/mineru/convert?inputSha=");
      return makeTarGzResponse(
        "test",
        "---\nsource:\n  converter: mineru\n---\n# Body\n",
        [["assets/images/fig.png", new Uint8Array([0xff, 0xd8])]]
      );
    }) as unknown as typeof fetch;
    const c = await convertSource(file, { fetch: fetchFn });
    expect(c.stem).toBe("test");
    expect(c.markdown).toContain("# Body");
    expect(c.assets.size).toBe(1);
    expect(Array.from(c.assets.get("assets/images/fig.png")!)).toEqual([0xff, 0xd8]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("appends the originalFilename query when provided, omits it otherwise", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "short.pdf", {
      type: "application/pdf"
    });
    const urls: string[] = [];
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return makeTarGzResponse("short", "# Body\n", []);
    }) as unknown as typeof fetch;

    await convertSource(file, {
      fetch: fetchFn,
      originalFilename: "真实的非常长的原始文件名.pdf"
    });
    expect(urls[0]).toContain(
      `originalFilename=${encodeURIComponent("真实的非常长的原始文件名.pdf")}`
    );

    await convertSource(file, { fetch: fetchFn });
    expect(urls[1]).not.toContain("originalFilename=");
  });

  it("hits the cache on second call (no fetch)", async () => {
    const file = new File([new Uint8Array([5, 6, 7])], "x.docx");
    const fetchFn = vi.fn(async () => makeTarGzResponse("x", "# X\n", [])) as unknown as typeof fetch;
    const cache = new MemoryConvertCache();
    await convertSource(file, { fetch: fetchFn, cache });
    const second = await convertSource(file, { fetch: fetchFn, cache });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.markdown).toContain("X");
  });

  it("maps sidecar JSON error envelope to MineruConvertError.code", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { code: "mineru_quota", message: "quota" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      })) as unknown as typeof fetch;
    await expect(convertSource(file, { fetch: fetchFn })).rejects.toMatchObject({
      name: "MineruConvertError",
      code: "mineru_quota"
    });
  });

  it("maps 503 mineru_disabled when sidecar lacks key", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { code: "mineru_disabled", message: "no key" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      })) as unknown as typeof fetch;
    await expect(convertSource(file, { fetch: fetchFn })).rejects.toMatchObject({
      code: "mineru_disabled"
    });
  });

  it("throws aborted when signal fires before fetch", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(
      convertSource(file, { fetch: fetchFn, signal: ctrl.signal })
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects unexpected response content-type as invalid_response", async () => {
    const file = new File([new Uint8Array([1])], "x.pdf");
    const fetchFn = (async () =>
      new Response("not a tar", { status: 200, headers: { "Content-Type": "text/plain" } })) as unknown as typeof fetch;
    await expect(convertSource(file, { fetch: fetchFn })).rejects.toMatchObject({
      code: "invalid_response"
    });
  });

  it("returns byte-stable result for identical input (same file → same markdown + same asset bytes)", async () => {
    // Same input file bytes, but separate File objects (and separate fetch
    // mocks) — output must be deterministic byte-for-byte.
    const bytes = new Uint8Array([10, 11, 12, 13]);
    const fileA = new File([new Uint8Array(bytes)], "doc.pdf");
    const fileB = new File([new Uint8Array(bytes)], "doc.pdf");
    const makeFetch = () =>
      (async () =>
        makeTarGzResponse("doc", "---\nsource:\n  converter: mineru\n---\n# X\n", [
          ["assets/img.png", new Uint8Array([0xff, 0xd8, 0xff])]
        ])) as unknown as typeof fetch;
    const a = await convertSource(fileA, { fetch: makeFetch() });
    const b = await convertSource(fileB, { fetch: makeFetch() });
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
      assets: new Map([["assets/images/fig.png", new Uint8Array([1, 2])]])
    };
    const files = convertedToFiles(c);
    // Synthetic root now suffixes the stem with the first 12 chars of
    // inputSha to keep two same-stem inputs from colliding into a
    // duplicate_path skip. Same bytes → same suffix → idempotency holds.
    const root = "test-deadbeefcafe";
    expect(files.map((f) => computeProjectRelPath(f)).sort()).toEqual([
      `${root}/assets/images/fig.png`,
      `${root}/test.md`
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
      assets: new Map<string, Uint8Array>()
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
        ["assets/a.png", new Uint8Array([1])]
      ])
    };
    const c2 = {
      input: c1.input,
      inputSha: c1.inputSha,
      stem: c1.stem,
      markdown: c1.markdown,
      assets: new Map([
        ["assets/a.png", new Uint8Array([1])],
        ["assets/b.png", new Uint8Array([2])]
      ])
    };
    const paths1 = convertedToFiles(c1).map((f) => f.webkitRelativePath);
    const paths2 = convertedToFiles(c2).map((f) => f.webkitRelativePath);
    expect(paths1).toEqual(paths2);
  });
});
