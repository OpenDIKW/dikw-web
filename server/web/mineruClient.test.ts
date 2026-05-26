// @vitest-environment node
//
// Behavior parity with dikw-converter-mineru/_client.py — same retry budget,
// same error-code classification, same OSS-PUT-without-Content-Type quirk,
// same token-redaction guarantee. Tests use a fetch double + a fake sleep
// so we never sleep wall-clock seconds in CI.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MineruClient,
  MineruClientError,
  type MineruFetch
} from "./mineruClient";

const TOKEN = "sk-secret-abcdef0123456789";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface ScriptedResponse {
  status?: number;
  body?: unknown; // becomes JSON unless `text` set
  text?: string;
  headers?: Record<string, string>;
  /** Stream body for stream() — body is delivered as one Uint8Array chunk. */
  bytes?: Uint8Array;
  /** Throw a network-style error instead of returning a response. */
  networkError?: string;
}

function makeFetch(script: ScriptedResponse[]): {
  fetch: MineruFetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetch: MineruFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (i >= script.length) {
      throw new Error(`unexpected fetch #${i + 1} to ${String(url)}`);
    }
    const next = script[i++];
    if (next.networkError) {
      throw new Error(next.networkError);
    }
    const headers = new Headers(next.headers ?? {});
    if (next.bytes) {
      const fresh = new ArrayBuffer(next.bytes.byteLength);
      new Uint8Array(fresh).set(next.bytes);
      return new Response(new Blob([fresh]), {
        status: next.status ?? 200,
        headers
      });
    }
    if (next.text !== undefined) {
      return new Response(next.text, { status: next.status ?? 200, headers });
    }
    const json = JSON.stringify(next.body ?? {});
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(json, { status: next.status ?? 200, headers });
  };
  return { fetch, calls };
}

describe("MineruClient.submit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns batch id + upload url on success", async () => {
    const { fetch, calls } = makeFetch([
      {
        body: {
          code: 0,
          data: {
            batch_id: "batch-123",
            file_urls: ["https://oss.example/up?signature=x"]
          }
        }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    const handle = await client.submit({
      fileName: "test.pdf",
      dataId: "deadbeef".repeat(4),
      modelVersion: "vlm"
    });
    expect(handle.batchId).toBe("batch-123");
    expect(handle.uploadUrl).toBe("https://oss.example/up?signature=x");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://mineru.net/api/v4/file-urls/batch");
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    const reqBody = JSON.parse(String(calls[0].init?.body));
    expect(reqBody.files[0].name).toBe("test.pdf");
    expect(reqBody.files[0].data_id).toBe("deadbeef".repeat(4));
    expect(reqBody.model_version).toBe("vlm");
    expect(reqBody.cache_tolerance).toBe(31_536_000);
  });

  it("retries 5xx three times then throws mineru_api", async () => {
    const { fetch, calls } = makeFetch([
      { status: 500, text: "server error" },
      { status: 502, text: "bad gateway" },
      { status: 503, text: "service unavailable" }
    ]);
    const sleeps: number[] = [];
    const client = new MineruClient({
      token: TOKEN,
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });
    await expect(
      client.submit({ fileName: "test.pdf", dataId: "x" })
    ).rejects.toMatchObject({
      name: "MineruClientError",
      code: "mineru_api"
    });
    expect(calls).toHaveLength(3);
    // Two backoffs between three attempts (none after the final attempt).
    expect(sleeps).toHaveLength(2);
  });

  it("classifies A0202 as mineru_auth and includes redacted token", async () => {
    const { fetch } = makeFetch([
      {
        status: 401,
        body: { code: "A0202", msg: `bad token ${TOKEN}` }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    try {
      await client.submit({ fileName: "test.pdf", dataId: "x" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as MineruClientError).code).toBe("mineru_auth");
      const message = (err as Error).message;
      expect(message).not.toContain(TOKEN);
      // Should contain the last 6 characters as the redacted suffix.
      expect(message).toContain("…6789");
    }
  });

  it("classifies -60018 as mineru_quota", async () => {
    const { fetch } = makeFetch([
      {
        status: 200,
        body: { code: "-60018", msg: "daily quota exceeded" }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    await expect(
      client.submit({ fileName: "test.pdf", dataId: "x" })
    ).rejects.toMatchObject({ code: "mineru_quota" });
  });
});

describe("MineruClient.upload", () => {
  it("PUTs without Content-Type header", async () => {
    const { fetch, calls } = makeFetch([{ status: 200 }]);
    const client = new MineruClient({ token: TOKEN, fetch });
    await client.upload(
      "https://oss.example/up",
      new Uint8Array([1, 2, 3])
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe("PUT");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("does NOT retry on PUT failure (OSS half-commit risk)", async () => {
    const { fetch, calls } = makeFetch([{ status: 500, text: "oops" }]);
    const client = new MineruClient({ token: TOKEN, fetch });
    await expect(
      client.upload("https://oss.example/up", new Uint8Array([1]))
    ).rejects.toMatchObject({ code: "mineru_api" });
    expect(calls).toHaveLength(1);
  });
});

describe("MineruClient.pollUntilDone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns full_zip_url when state is done", async () => {
    const { fetch } = makeFetch([
      {
        body: {
          code: 0,
          data: {
            extract_result: [
              {
                state: "done",
                full_zip_url: "https://cdn.example/result.zip"
              }
            ]
          }
        }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    const url = await client.pollUntilDone("batch-123");
    expect(url).toBe("https://cdn.example/result.zip");
  });

  it("raises mineru_timeout when deadline expires before done", async () => {
    const responses: ScriptedResponse[] = [];
    for (let i = 0; i < 100; i++) {
      responses.push({
        body: {
          code: 0,
          data: { extract_result: [{ state: "running" }] }
        }
      });
    }
    const { fetch } = makeFetch(responses);
    let now = 0;
    const client = new MineruClient({
      token: TOKEN,
      fetch,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
      pollTotalTimeoutMs: 1_000
    });
    await expect(client.pollUntilDone("batch-123")).rejects.toMatchObject({
      code: "mineru_timeout"
    });
  });

  it("raises classified error when task state is failed", async () => {
    const { fetch } = makeFetch([
      {
        body: {
          code: 0,
          data: {
            extract_result: [
              { state: "failed", err_code: "-60018", err_msg: "quota" }
            ]
          }
        }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    await expect(client.pollUntilDone("batch-123")).rejects.toMatchObject({
      code: "mineru_quota"
    });
  });
});

describe("MineruClient.downloadZip", () => {
  it("returns body bytes when Content-Length is within cap", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    const { fetch } = makeFetch([
      {
        bytes,
        headers: { "Content-Length": "4" }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    const out = await client.downloadZip("https://cdn.example/result.zip");
    expect(Array.from(out)).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("refuses to buffer when Content-Length exceeds cap", async () => {
    const { fetch } = makeFetch([
      {
        bytes: new Uint8Array(),
        headers: { "Content-Length": String(512 * 1024 * 1024) }
      }
    ]);
    const client = new MineruClient({ token: TOKEN, fetch });
    await expect(
      client.downloadZip("https://cdn.example/huge.zip")
    ).rejects.toMatchObject({ code: "mineru_input" });
  });
});

describe("MineruClient — token redaction", () => {
  it("never echoes the full token in error messages (network error path)", async () => {
    const fetch: MineruFetch = async () => {
      throw new Error(`connect failed token=${TOKEN}`);
    };
    const sleeps: number[] = [];
    const client = new MineruClient({
      token: TOKEN,
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });
    try {
      await client.submit({ fileName: "x.pdf", dataId: "x" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(TOKEN);
    }
  });
});
