// @vitest-environment node
//
// Black-box tests for the /web/* HTTP handler. We exercise the handler
// with synthetic IncomingMessage / ServerResponse instances and a fetch
// double, so the tests don't touch the network.

import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { deflateRawSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createWebHandler, type WebHandler } from "./http";
import { JobStore } from "./jobStore";
import { readTar } from "../../src/utils/tar-reader";

function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

const TOKEN = "sk-mineru-deadbeef0123456789";

// ------ minimal req/res doubles ------

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function makeReq(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer;
}): IncomingMessage {
  const body = opts.body ?? Buffer.alloc(0);
  const stream = Readable.from([body]) as unknown as IncomingMessage;
  Object.defineProperty(stream, "method", { value: opts.method, enumerable: true });
  Object.defineProperty(stream, "url", { value: opts.url, enumerable: true });
  Object.defineProperty(stream, "headers", {
    value: opts.headers ?? {},
    enumerable: true,
  });
  return stream;
}

function makeRes(): { res: ServerResponse; captured: Promise<CapturedResponse> } {
  const chunks: Buffer[] = [];
  let status = 200;
  const headers: Record<string, string> = {};
  let resolveCaptured!: (v: CapturedResponse) => void;
  const captured = new Promise<CapturedResponse>((resolve) => {
    resolveCaptured = resolve;
  });
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    write(chunk: Buffer | string) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk?: Buffer | string | Uint8Array) {
      if (chunk !== undefined) {
        // A real ServerResponse accepts Buffer | string | Uint8Array; the job
        // result is a plain Uint8Array, so copy bytes faithfully instead of
        // stringifying it.
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk));
      }
      status = (this as { statusCode: number }).statusCode;
      resolveCaptured({ status, headers, body: Buffer.concat(chunks) });
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

// ------ multipart helper ------

function makeMultipart(
  filename: string,
  mediaType: string,
  data: Buffer,
): { body: Buffer; contentType: string } {
  const boundary = "----dikwweb-test-boundary-12345";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  return {
    body: Buffer.concat([head, data, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ------ fixture zip (reused from mineruConvert.test.ts logic, condensed) ------

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;

function crc32(bytes: Uint8Array): number {
  let table = (crc32 as unknown as { table?: Uint32Array }).table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    (crc32 as unknown as { table?: Uint32Array }).table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeFixtureZip(map: Map<string, Uint8Array>): Uint8Array {
  const built: Array<{
    name: string;
    method: number;
    uncompressed: Uint8Array;
    compressed: Uint8Array;
    crc: number;
  }> = [];
  for (const [name, data] of map) {
    const compressed = new Uint8Array(deflateRawSync(data));
    built.push({
      name,
      method: 8,
      uncompressed: data,
      compressed,
      crc: crc32(data),
    });
  }
  const lfhOffsets: number[] = [];
  let offset = 0;
  const nameBytes = built.map((e) => new TextEncoder().encode(e.name));
  for (let i = 0; i < built.length; i++) {
    lfhOffsets.push(offset);
    offset += 30 + nameBytes[i].byteLength + built[i].compressed.byteLength;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (let i = 0; i < built.length; i++) cdSize += 46 + nameBytes[i].byteLength;
  const total = cdStart + cdSize + 22;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < built.length; i++) {
    const e = built[i];
    const off = lfhOffsets[i];
    view.setUint32(off, SIG_LFH, true);
    view.setUint16(off + 4, 20, true);
    view.setUint16(off + 6, FLAG_UTF8, true);
    view.setUint16(off + 8, e.method, true);
    view.setUint16(off + 10, 0, true);
    view.setUint16(off + 12, 0, true);
    view.setUint32(off + 14, e.crc, true);
    view.setUint32(off + 18, e.compressed.byteLength, true);
    view.setUint32(off + 22, e.uncompressed.byteLength, true);
    view.setUint16(off + 26, nameBytes[i].byteLength, true);
    view.setUint16(off + 28, 0, true);
    buf.set(nameBytes[i], off + 30);
    buf.set(e.compressed, off + 30 + nameBytes[i].byteLength);
  }
  let cdOff = cdStart;
  for (let i = 0; i < built.length; i++) {
    const e = built[i];
    view.setUint32(cdOff, SIG_CD, true);
    view.setUint16(cdOff + 4, 20, true);
    view.setUint16(cdOff + 6, 20, true);
    view.setUint16(cdOff + 8, FLAG_UTF8, true);
    view.setUint16(cdOff + 10, e.method, true);
    view.setUint16(cdOff + 12, 0, true);
    view.setUint16(cdOff + 14, 0, true);
    view.setUint32(cdOff + 16, e.crc, true);
    view.setUint32(cdOff + 20, e.compressed.byteLength, true);
    view.setUint32(cdOff + 24, e.uncompressed.byteLength, true);
    view.setUint16(cdOff + 28, nameBytes[i].byteLength, true);
    view.setUint16(cdOff + 30, 0, true);
    view.setUint16(cdOff + 32, 0, true);
    view.setUint16(cdOff + 34, 0, true);
    view.setUint16(cdOff + 36, 0, true);
    view.setUint32(cdOff + 38, 0, true);
    view.setUint32(cdOff + 42, lfhOffsets[i], true);
    buf.set(nameBytes[i], cdOff + 46);
    cdOff += 46 + nameBytes[i].byteLength;
  }
  const eocd = cdStart + cdSize;
  view.setUint32(eocd, SIG_EOCD, true);
  view.setUint16(eocd + 4, 0, true);
  view.setUint16(eocd + 6, 0, true);
  view.setUint16(eocd + 8, built.length, true);
  view.setUint16(eocd + 10, built.length, true);
  view.setUint32(eocd + 12, cdSize, true);
  view.setUint32(eocd + 16, cdStart, true);
  view.setUint16(eocd + 20, 0, true);
  return buf;
}

/** Standard mineru.net pipeline double: submit → upload → poll → download
 *  the given result zip. */
function mineruFetchMock(fixtureZip: Uint8Array): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    const u = String(url);
    if (u === "https://mineru.net/api/v4/file-urls/batch") {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            batch_id: "batch-id-1",
            file_urls: ["https://oss.example/up?sig=x"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u === "https://oss.example/up?sig=x" && init?.method === "PUT") {
      return new Response("", { status: 200 });
    }
    if (u.startsWith("https://mineru.net/api/v4/extract-results/batch/")) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            extract_result: [{ state: "done", full_zip_url: "https://cdn.example/result.zip" }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u === "https://cdn.example/result.zip") {
      const fresh = new ArrayBuffer(fixtureZip.byteLength);
      new Uint8Array(fresh).set(fixtureZip);
      return new Response(new Blob([fresh]), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as unknown as typeof fetch;
}

// ------ job-flow helpers (issue #60: submit → poll → result) ------

async function submitConvert(
  handler: WebHandler,
  opts: { inputSha: string; body: Buffer; contentType: string; originalFilename?: string },
): Promise<CapturedResponse> {
  let url = `/mineru/convert?inputSha=${opts.inputSha}`;
  if (opts.originalFilename) {
    url += `&originalFilename=${encodeURIComponent(opts.originalFilename)}`;
  }
  const { res, captured } = makeRes();
  await handler(
    makeReq({
      method: "POST",
      url,
      headers: { "content-type": opts.contentType },
      body: opts.body,
    }),
    res,
  );
  return captured;
}

async function getJob(handler: WebHandler, jobId: string): Promise<CapturedResponse> {
  const { res, captured } = makeRes();
  await handler(makeReq({ method: "GET", url: `/mineru/jobs/${jobId}` }), res);
  return captured;
}

async function getJobResult(handler: WebHandler, jobId: string): Promise<CapturedResponse> {
  const { res, captured } = makeRes();
  await handler(makeReq({ method: "GET", url: `/mineru/jobs/${jobId}/result` }), res);
  return captured;
}

async function cancelJob(handler: WebHandler, jobId: string): Promise<CapturedResponse> {
  const { res, captured } = makeRes();
  await handler(makeReq({ method: "POST", url: `/mineru/jobs/${jobId}/cancel` }), res);
  return captured;
}

/** Yield to the event loop (incl. the libuv threadpool behind async gzip) until
 *  the detached conversion job reaches a terminal state. */
async function driveJob(store: JobStore, jobId: string, maxMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const job = store.get(jobId);
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`job ${jobId} did not reach a terminal state within ${maxMs}ms`);
}

function jsonBody(r: CapturedResponse): {
  jobId?: string;
  status?: string;
  ok?: boolean;
  error?: { code?: string; message?: string };
} {
  return JSON.parse(r.body.toString("utf-8"));
}

/** A fetch double whose poll never reports "done", so the job stays running. */
function pendingForeverFetch(): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    const u = String(url);
    if (u === "https://mineru.net/api/v4/file-urls/batch") {
      return new Response(
        JSON.stringify({
          code: 0,
          data: { batch_id: "b1", file_urls: ["https://oss.example/up?sig=x"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u === "https://oss.example/up?sig=x" && init?.method === "PUT") {
      return new Response("", { status: 200 });
    }
    if (u.startsWith("https://mineru.net/api/v4/extract-results/batch/")) {
      return new Response(
        JSON.stringify({ code: 0, data: { extract_result: [{ state: "pending" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch to ${u}`);
  }) as unknown as typeof fetch;
}

// ------ tests ------

describe("/web/mineru/health", () => {
  it("returns enabled=true when key is configured", async () => {
    const handler = createWebHandler({ config: { mineruApiKey: TOKEN } });
    const req = makeReq({ method: "GET", url: "/mineru/health" });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body.toString("utf-8"));
    expect(body).toEqual({ enabled: true, hasKey: true });
  });

  it("returns enabled=false when key is missing", async () => {
    const handler = createWebHandler({ config: {} });
    const req = makeReq({ method: "GET", url: "/mineru/health" });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    const body = JSON.parse(r.body.toString("utf-8"));
    expect(body).toEqual({ enabled: false, hasKey: false });
  });
});

describe("/web/mineru/convert — guards", () => {
  it("returns 503 mineru_disabled when key missing", async () => {
    const handler = createWebHandler({ config: {} });
    const req = makeReq({
      method: "POST",
      url: "/mineru/convert?inputSha=abc",
      headers: { "content-type": "multipart/form-data; boundary=xyz" },
    });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    expect(r.status).toBe(503);
    const body = JSON.parse(r.body.toString("utf-8"));
    expect(body.error.code).toBe("mineru_disabled");
  });

  it("returns 400 missing_input_sha when no inputSha query param", async () => {
    const handler = createWebHandler({ config: { mineruApiKey: TOKEN } });
    const req = makeReq({
      method: "POST",
      url: "/mineru/convert",
      headers: { "content-type": "multipart/form-data; boundary=xyz" },
    });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    expect(r.status).toBe(400);
    const body = JSON.parse(r.body.toString("utf-8"));
    expect(body.error.code).toBe("missing_input_sha");
  });
});

describe("/web/mineru/convert — happy path (mocked mineru)", () => {
  it("submits a job, then GET jobs/<id>/result returns tar.gz with stem.md + sorted assets", async () => {
    const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const inputSha = sha256Hex(fileBytes);
    const fixtureMd = "# Title\n\n![](images/fig.png)\n";
    const fixturePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fixtureZip = makeFixtureZip(
      new Map([
        ["full.md", new TextEncoder().encode(fixtureMd)],
        ["images/fig.png", fixturePng],
      ]),
    );
    const { body, contentType } = makeMultipart("test.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: mineruFetchMock(fixtureZip),
      jobStore,
    });

    // Submit returns immediately with a job id — the request never holds open
    // for the conversion (issue #60).
    const submit = await submitConvert(handler, { inputSha, body, contentType });
    expect(submit.status).toBe(202);
    const submitted = jsonBody(submit);
    expect(typeof submitted.jobId).toBe("string");
    expect(submitted.status).toBe("pending");
    const jobId = submitted.jobId!;

    await driveJob(jobStore, jobId);

    const status = await getJob(handler, jobId);
    expect(status.status).toBe(200);
    expect(jsonBody(status).status).toBe("succeeded");

    const result = await getJobResult(handler, jobId);
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/x-tar+gzip");
    const tar = gunzipSync(result.body);
    const entries = readTar(new Uint8Array(tar));
    const names = entries.map((e) => e.archivePath).sort();
    expect(names).toEqual(["assets/images/fig.png", "test.md"]);
    const md = new TextDecoder().decode(entries.find((e) => e.archivePath === "test.md")!.data);
    // Flat, deterministic frontmatter (ADR 0004): no nested object, no sha, no
    // timestamps — the Base reader renders nested values as JSON.
    expect(md).toContain('\noriginal_filename: "test.pdf"\n');
    expect(md).toContain('\nconverter: "mineru"\n');
    expect(md).not.toContain("source:");
    expect(md).not.toContain("original_sha256");
    // Image ref rewritten to wikilink form.
    expect(md).toContain("![[assets/images/fig.png]]");
  });

  it("preserves the originalFilename query in frontmatter while naming the markdown after the (shortened) upload", async () => {
    const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const inputSha = sha256Hex(fileBytes);
    const fixtureZip = makeFixtureZip(
      new Map([["full.md", new TextEncoder().encode("# Title\n")]]),
    );
    // The browser uploads under a shortened name but forwards the true
    // original so frontmatter stays honest.
    const original = "真实的非常长的原始文件名超过二十五个字符的文档.pdf";
    const { body, contentType } = makeMultipart("shortname.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: mineruFetchMock(fixtureZip),
      jobStore,
    });

    const submit = await submitConvert(handler, {
      inputSha,
      body,
      contentType,
      originalFilename: original,
    });
    expect(submit.status).toBe(202);
    const jobId = jsonBody(submit).jobId!;
    await driveJob(jobStore, jobId);

    const result = await getJobResult(handler, jobId);
    expect(result.status).toBe(200);
    const entries = readTar(new Uint8Array(gunzipSync(result.body)));
    // Markdown named after the uploaded (shortened) filename → matches the
    // browser's `${stem}.md` lookup.
    expect(entries.map((e) => e.archivePath)).toContain("shortname.md");
    const md = new TextDecoder().decode(
      entries.find((e) => e.archivePath === "shortname.md")!.data,
    );
    // Frontmatter keeps the true original, not the shortened upload name.
    expect(md).toContain(`original_filename: "${original}"`);
  });

  it("surfaces a mineru_auth failure on the job status, not the submit response", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ code: "A0202", msg: "bad token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    const fileBytes = Buffer.from([0x78, 0x78]);
    const inputSha = sha256Hex(fileBytes);
    const { body, contentType } = makeMultipart("x.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: fetchMock,
      jobStore,
    });

    // The POST still succeeds (202) — the upstream auth error only emerges once
    // the detached job runs, reported via the status endpoint with the same
    // code the browser's pickErrorCode understands.
    const submit = await submitConvert(handler, { inputSha, body, contentType });
    expect(submit.status).toBe(202);
    const jobId = jsonBody(submit).jobId!;
    await driveJob(jobStore, jobId);

    const status = await getJob(handler, jobId);
    expect(status.status).toBe(200);
    const parsed = jsonBody(status);
    expect(parsed.status).toBe("failed");
    expect(parsed.error?.code).toBe("mineru_auth");
  });

  it("rejects with input_sha_mismatch when claimed sha doesn't match bytes", async () => {
    const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const wrongSha = "0".repeat(64);
    const { body, contentType } = makeMultipart("x.pdf", "application/pdf", fileBytes);
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: (async () => {
        throw new Error("should not be reached");
      }) as unknown as typeof fetch,
    });
    const req = makeReq({
      method: "POST",
      url: `/mineru/convert?inputSha=${wrongSha}`,
      headers: { "content-type": contentType },
      body,
    });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    expect(r.status).toBe(400);
    const body2 = JSON.parse(r.body.toString("utf-8"));
    expect(body2.error.code).toBe("input_sha_mismatch");
  });

  it("rejects with invalid_input_sha when claimed sha is not 64-hex", async () => {
    const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const { body, contentType } = makeMultipart("x.pdf", "application/pdf", fileBytes);
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: (async () => {
        throw new Error("should not be reached");
      }) as unknown as typeof fetch,
    });
    const req = makeReq({
      method: "POST",
      url: "/mineru/convert?inputSha=not-a-hex-digest",
      headers: { "content-type": contentType },
      body,
    });
    const { res, captured } = makeRes();
    await handler(req, res);
    const r = await captured;
    expect(r.status).toBe(400);
    const body2 = JSON.parse(r.body.toString("utf-8"));
    expect(body2.error.code).toBe("invalid_input_sha");
  });
});

describe("/web/mineru/jobs — status / result / cancel", () => {
  it("returns 404 not_found for an unknown job id", async () => {
    const handler = createWebHandler({ config: { mineruApiKey: TOKEN } });
    const r = await getJob(handler, "does-not-exist");
    expect(r.status).toBe(404);
    expect(jsonBody(r).error?.code).toBe("not_found");
  });

  it("reports running, refuses the result with 409 not_ready, and cancel drives it to failed", async () => {
    const fileBytes = Buffer.from([0x25, 0x50]);
    const inputSha = sha256Hex(fileBytes);
    const { body, contentType } = makeMultipart("x.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: pendingForeverFetch(),
      jobStore,
    });

    const submit = await submitConvert(handler, { inputSha, body, contentType });
    expect(submit.status).toBe(202);
    const jobId = jsonBody(submit).jobId!;

    // Result isn't ready while the job is still in flight.
    const early = await getJobResult(handler, jobId);
    expect(early.status).toBe(409);
    expect(jsonBody(early).error?.code).toBe("not_ready");

    // Cancel aborts the in-flight conversion; the detached runner then records
    // a terminal failed state (and the abort clears the poll's backoff timer).
    const cancelled = await cancelJob(handler, jobId);
    expect(cancelled.status).toBe(200);
    expect(jsonBody(cancelled).ok).toBe(true);
    await driveJob(jobStore, jobId);
    expect(jsonBody(await getJob(handler, jobId)).status).toBe("failed");
  });

  it("serves the result idempotently — repeated fetches return the same 200 (retry-safe)", async () => {
    const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const inputSha = sha256Hex(fileBytes);
    const fixtureZip = makeFixtureZip(new Map([["full.md", new TextEncoder().encode("# One\n")]]));
    const { body, contentType } = makeMultipart("one.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: mineruFetchMock(fixtureZip),
      jobStore,
    });

    const submit = await submitConvert(handler, { inputSha, body, contentType });
    const jobId = jsonBody(submit).jobId!;
    await driveJob(jobStore, jobId);

    // Result reads do NOT consume the job (issue #60): a /result transfer cut by
    // a flaky proxy must be retriable, so the job stays queryable and a second
    // fetch returns the identical bytes — reclaim is left to the TTL / byte cap.
    const first = await getJobResult(handler, jobId);
    expect(first.status).toBe(200);
    expect(jsonBody(await getJob(handler, jobId)).status).toBe("succeeded");
    const second = await getJobResult(handler, jobId);
    expect(second.status).toBe(200);
    expect(second.body.equals(first.body)).toBe(true);
  });

  it("a failing conversion becomes a failed job with a mapped code (no unhandled rejection)", async () => {
    // Submit returns 200 but missing batch_id → client.submit throws mineru_api
    // synchronously (no retry), exercising the detached runner's catch.
    const fetchMock: typeof fetch = (async (url: URL | RequestInfo) => {
      const u = String(url);
      if (u === "https://mineru.net/api/v4/file-urls/batch") {
        return new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch to ${u}`);
    }) as unknown as typeof fetch;
    const fileBytes = Buffer.from([0x01, 0x02]);
    const inputSha = sha256Hex(fileBytes);
    const { body, contentType } = makeMultipart("y.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore();
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: fetchMock,
      jobStore,
    });

    const submit = await submitConvert(handler, { inputSha, body, contentType });
    expect(submit.status).toBe(202);
    const jobId = jsonBody(submit).jobId!;
    await driveJob(jobStore, jobId);

    const status = await getJob(handler, jobId);
    expect(jsonBody(status).status).toBe("failed");
    expect(jsonBody(status).error?.code).toBe("mineru_api");
  });

  it("rejects creating beyond the live-job cap with 503 too_many_jobs", async () => {
    const fileBytes = Buffer.from([0x25, 0x50]);
    const inputSha = sha256Hex(fileBytes);
    const { body, contentType } = makeMultipart("x.pdf", "application/pdf", fileBytes);
    const jobStore = new JobStore({ maxLiveJobs: 1 });
    const handler = createWebHandler({
      config: { mineruApiKey: TOKEN },
      fetch: pendingForeverFetch(),
      jobStore,
    });

    const first = await submitConvert(handler, { inputSha, body, contentType });
    expect(first.status).toBe(202);
    // Second submit while the first job is still live → over the cap.
    const second = await submitConvert(handler, { inputSha, body, contentType });
    expect(second.status).toBe(503);
    expect(jsonBody(second).error?.code).toBe("too_many_jobs");

    // Clean up the lingering background poll loop.
    await cancelJob(handler, jsonBody(first).jobId!);
    await driveJob(jobStore, jsonBody(first).jobId!);
  });
});
