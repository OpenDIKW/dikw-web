import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DikwClient, DikwClientError, buildRequestUrl, normalizeBaseUrl } from "./client";
import type {
  EventsPage,
  TaskEvent,
  TaskHandle,
  TaskListPage,
  TaskRow
} from "../types";

describe("DikwClient URL helpers", () => {
  it("normalizes a trailing slash", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
  });

  it("builds same-origin proxy URLs", () => {
    expect(buildRequestUrl("", "/v1/status", { limit: 10 })).toBe("/v1/status?limit=10");
  });

  it("builds absolute server URLs", () => {
    expect(buildRequestUrl("http://127.0.0.1:8765", "/v1/tasks", { status: "running" })).toBe(
      "http://127.0.0.1:8765/v1/tasks?status=running"
    );
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  });
}

describe("DikwClient.streamTaskEvents (cursor-paged)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("第一次请求带 wait=30、不带 from_seq，按页 yield 事件直到终态", async () => {
    const page: EventsPage = {
      task_id: "t-1",
      task_status: "succeeded",
      events: [
        { type: "task_started", seq: 1, ts: "2026-05-17T00:00:00Z", task_id: "t-1", op: "ingest" } as TaskEvent,
        {
          type: "final",
          seq: 2,
          ts: "2026-05-17T00:00:01Z",
          status: "succeeded",
          result: { added: 1 },
          error: null
        } as TaskEvent
      ],
      next_from_seq: 3,
      has_more: false,
      last_seq: 2
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(page));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const seen: TaskEvent[] = [];
    for await (const event of client.streamTaskEvents("t-1")) {
      seen.push(event);
    }

    expect(seen).toHaveLength(2);
    expect(seen[1].type).toBe("final");

    const [calledUrl] = fetchSpy.mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/v1/tasks/t-1/events");
    expect(url.searchParams.get("wait")).toBe("30");
    expect(url.searchParams.get("from_seq")).toBeNull();
  });

  it("在 has_more=false 但 task_status=running 时继续请求，直到看到终态", async () => {
    const page1: EventsPage = {
      task_id: "t-2",
      task_status: "running",
      events: [
        { type: "task_started", seq: 1, ts: "2026-05-17T00:00:00Z", task_id: "t-2", op: "ingest" } as TaskEvent
      ],
      next_from_seq: 2,
      has_more: false,
      last_seq: 1
    };
    const page2Empty: EventsPage = {
      task_id: "t-2",
      task_status: "running",
      events: [],
      next_from_seq: 2,
      has_more: false,
      last_seq: 1
    };
    const page3: EventsPage = {
      task_id: "t-2",
      task_status: "succeeded",
      events: [
        {
          type: "final",
          seq: 2,
          ts: "2026-05-17T00:00:05Z",
          status: "succeeded",
          result: { added: 1 },
          error: null
        } as TaskEvent
      ],
      next_from_seq: 3,
      has_more: false,
      last_seq: 2
    };

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2Empty))
      .mockResolvedValueOnce(jsonResponse(page3));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const seen: TaskEvent[] = [];
    for await (const event of client.streamTaskEvents("t-2")) {
      seen.push(event);
    }

    expect(seen.map((event) => event.type)).toEqual(["task_started", "final"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const cursors = fetchSpy.mock.calls.map(([input]: [RequestInfo | URL, ...unknown[]]) =>
      new URL(String(input)).searchParams.get("from_seq")
    );
    expect(cursors).toEqual([null, "2", "2"]);
  });

  it("AbortSignal 透传至 fetch 并停止生成器", async () => {
    const controller = new AbortController();
    const runningPage: EventsPage = {
      task_id: "t-3",
      task_status: "running",
      events: [],
      next_from_seq: 1,
      has_more: false,
      last_seq: 0
    };

    fetchSpy.mockImplementation(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      queueMicrotask(() => controller.abort());
      return jsonResponse(runningPage);
    });

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const generator = client.streamTaskEvents("t-3", undefined, controller.signal);

    await expect(async () => {
      for await (const _event of generator) {
        // 第二次循环时 signal.aborted=true，fetch 抛出 AbortError
      }
    }).rejects.toThrowError(/abort/i);
  });
});

describe("DikwClient.streamTaskEvents — transient gateway/network resilience", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  /** A raw non-JSON gateway/proxy error body — what a tunnel actually returns
   *  on a 5xx, exercising the ``http_<status>`` fallback in errorFromResponse. */
  function errorResponse(status: number, body = "upstream error"): Response {
    return new Response(body, { status });
  }

  function runningPage(seq: number): EventsPage {
    return {
      task_id: "t",
      task_status: "running",
      events: [
        {
          type: "task_started",
          seq,
          ts: "2026-05-30T00:00:00Z",
          task_id: "t",
          op: "synth"
        } as TaskEvent
      ],
      next_from_seq: seq + 1,
      has_more: false,
      last_seq: seq
    };
  }

  function terminalPage(seq: number): EventsPage {
    return {
      task_id: "t",
      task_status: "succeeded",
      events: [
        {
          type: "final",
          seq,
          ts: "2026-05-30T00:00:05Z",
          status: "succeeded",
          result: { added: 1 },
          error: null
        } as TaskEvent
      ],
      next_from_seq: seq + 1,
      has_more: false,
      last_seq: seq
    };
  }

  it("retries a transient 502 and resumes the poll from the same from_seq", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(runningPage(1))) // ok → cursor advances to 2
      .mockResolvedValueOnce(errorResponse(502)) // transient 502 → retry, cursor stays 2
      .mockResolvedValueOnce(jsonResponse(terminalPage(2))); // ok terminal

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const seen: TaskEvent[] = [];
    const drain = (async () => {
      for await (const event of client.streamTaskEvents("t")) seen.push(event);
    })();
    await vi.runAllTimersAsync();
    await drain;

    expect(seen.map((event) => event.type)).toEqual(["task_started", "final"]);
    // The failed poll and its retry both target from_seq=2 — the cursor never
    // advanced past the page that errored.
    const cursors = fetchSpy.mock.calls.map(([input]: [RequestInfo | URL, ...unknown[]]) =>
      new URL(String(input)).searchParams.get("from_seq")
    );
    expect(cursors).toEqual([null, "2", "2"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries a network-level fetch failure (TypeError) and reconnects", async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // dropped connection → retry
      .mockResolvedValueOnce(jsonResponse(terminalPage(1)));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const seen: TaskEvent[] = [];
    const drain = (async () => {
      for await (const event of client.streamTaskEvents("t")) seen.push(event);
    })();
    await vi.runAllTimersAsync();
    await drain;

    expect(seen.map((event) => event.type)).toEqual(["final"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry cap is exceeded and rethrows the last error", async () => {
    fetchSpy.mockImplementation(async () => errorResponse(502)); // fresh body per poll; upstream stays down

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const drain = (async () => {
      for await (const _event of client.streamTaskEvents("t")) {
        // drain to exhaustion
      }
    })();
    const settled = drain.then(() => null).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;

    expect(error).toBeInstanceOf(DikwClientError);
    expect((error as DikwClientError).status).toBe(502);
    // first attempt + 8 retries (FOLLOW_MAX_RETRIES) = 9 polls before giving up
    expect(fetchSpy).toHaveBeenCalledTimes(9);
  });

  it("does NOT retry a non-transient 4xx (404)", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(404, "task not found"));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const drain = (async () => {
      for await (const _event of client.streamTaskEvents("t")) {
        // drain
      }
    })();
    const settled = drain.then(() => null).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;

    expect(error).toBeInstanceOf(DikwClientError);
    expect((error as DikwClientError).status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // threw immediately, no retry
  });

  it("aborts promptly when the signal fires during backoff", async () => {
    const controller = new AbortController();
    fetchSpy.mockImplementation(async () => errorResponse(503)); // 503 → enters backoff

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const drain = (async () => {
      for await (const _event of client.streamTaskEvents(
        "t",
        undefined,
        controller.signal
      )) {
        // drain
      }
    })();
    const settled = drain.then(() => null).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0); // first poll fails → into abortableDelay
    controller.abort(); // fire the abort mid-backoff
    await vi.advanceTimersByTimeAsync(0); // flush the rejection
    const error = await settled;

    expect((error as Error).name).toBe("AbortError");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry poll after abort
  });
});

describe("DikwClient.getTaskFinalEvent (authoritative reconcile)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      task_id: "t-1",
      op: "ingest",
      status: "succeeded",
      created_at: "2026-05-29T11:31:22Z",
      started_at: "2026-05-29T11:31:22Z",
      finished_at: "2026-05-29T11:31:33Z",
      params_digest: "ee56d64205e62d21",
      result: { scanned: 70, added: 0, errors: [] },
      error: null,
      ...overrides
    };
  }

  it("synthesizes a final event from the authoritative task row when terminal", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(taskRow()));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const final = await client.getTaskFinalEvent("t-1");

    expect(final).toEqual({
      type: "final",
      seq: -1,
      ts: "2026-05-29T11:31:33Z",
      status: "succeeded",
      result: { scanned: 70, added: 0, errors: [] },
      error: null
    });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/tasks/t-1");
  });

  it("carries a failed row's error so the caller can surface it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        taskRow({ status: "failed", result: null, error: { message: "boom" } })
      )
    );

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const final = await client.getTaskFinalEvent("t-1");

    expect(final?.status).toBe("failed");
    expect(final?.error).toEqual({ message: "boom" });
  });

  it("returns null when the task is still non-terminal", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(taskRow({ status: "running", finished_at: null, result: null }))
    );

    const client = new DikwClient({ baseUrl: "http://core.test" });
    expect(await client.getTaskFinalEvent("t-1")).toBeNull();
  });
});

describe("DikwClient.listTasks (cursor envelope)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("把 status/op/limit/cursor 拼进 query 并返回 TaskListPage 信封", async () => {
    const page: TaskListPage = {
      tasks: [
        {
          task_id: "t-1",
          op: "ingest",
          status: "succeeded",
          created_at: "2026-05-20T00:00:00Z",
          started_at: "2026-05-20T00:00:01Z",
          finished_at: "2026-05-20T00:00:05Z",
          params_digest: "d1"
        }
      ],
      next_cursor: "next-1",
      has_more: true
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(page));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const result = await client.listTasks({ status: "succeeded", op: "ingest", limit: 50, cursor: "c0" });

    expect(result).toEqual(page);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/tasks");
    expect(url.searchParams.get("status")).toBe("succeeded");
    expect(url.searchParams.get("op")).toBe("ingest");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("cursor")).toBe("c0");
  });

  it("省略的参数不出现在 query 中", async () => {
    const page: TaskListPage = { tasks: [], next_cursor: null, has_more: false };
    fetchSpy.mockResolvedValueOnce(jsonResponse(page));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    await client.listTasks({ limit: 50 });

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("cursor")).toBeNull();
    expect(url.searchParams.get("status")).toBeNull();
    expect(url.searchParams.get("op")).toBeNull();
    expect(url.searchParams.get("limit")).toBe("50");
  });
});

describe("DikwClient import + pipeline submits", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("importBundle 走 multipart,字段名 payload+manifest,带 Bearer 不带 Content-Type", async () => {
    const resp = {
      import_id: "abc",
      files_count: 2,
      bytes: 42,
      applied_at: "2026-05-24T00:00:00Z",
      committed: [0],
      rejected: []
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(resp));

    const client = new DikwClient({ baseUrl: "http://core.test", token: "T" });
    const payload = new Blob([new Uint8Array([0x1f, 0x8b])], { type: "application/gzip" });
    const out = await client.importBundle(payload, "{\"files\":[]}");

    expect(out).toEqual(resp);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(String(calledUrl)).pathname).toBe("/v1/import");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("manifest")).toBe("{\"files\":[]}");
    expect(body.get("payload")).toBeInstanceOf(Blob);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer T");
    // Multipart Content-Type must be set by the browser, not by us.
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("startIngest / startSynth / startLintPropose / startLintApply 投递正确 body", async () => {
    const handle: TaskHandle = {
      task_id: "t-x",
      op: "ingest",
      status: "pending",
      created_at: "2026-05-24T00:00:00Z",
      links: {}
    };
    // Each call gets a fresh Response — body is single-read.
    fetchSpy.mockImplementation(async () => jsonResponse(handle));

    const client = new DikwClient({ baseUrl: "http://core.test" });

    await client.startIngest();
    await client.startSynth({ forceAll: true });
    await client.startLintPropose({ rule: "broken_wikilink", limit: 20 });
    await client.startLintApply({ proposalTaskId: "p-1", pick: [0, 2] });

    const bodies = fetchSpy.mock.calls.map(([, init]: [unknown, RequestInit]) =>
      JSON.parse(String(init.body))
    );
    expect(bodies[0]).toEqual({ no_embed: false });
    expect(bodies[1]).toEqual({ force_all: true, no_embed: false });
    expect(bodies[2]).toEqual({ rule: "broken_wikilink", limit: 20, enable_llm: false });
    expect(bodies[3]).toEqual({
      proposal_task_id: "p-1",
      pick: [0, 2],
      skip: null
    });

    const urls = fetchSpy.mock.calls.map(([u]: [unknown]) => new URL(String(u)).pathname);
    expect(urls).toEqual([
      "/v1/ingest",
      "/v1/synth",
      "/v1/lint/propose",
      "/v1/lint/apply"
    ]);
  });

  it("getTaskResult 拆开 TaskResultBody 信封,只把 result 字段返回给调用方", async () => {
    // server returns the envelope; callers want the unwrapped payload so
    // ``proposeResult.proposals`` and ``applyReport.applied`` resolve as
    // expected (round-2 codex regression).
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        task_id: "apply-1",
        status: "succeeded",
        started_at: "2026-05-24T00:00:00Z",
        finished_at: "2026-05-24T00:00:05Z",
        result: { applied: [{ kind: "update_page", path: "K/x.md" }], skipped: [] },
        error: null
      })
    );
    const client = new DikwClient({ baseUrl: "http://core.test" });
    const out = await client.getTaskResult<{ applied: unknown[]; skipped: unknown[] }>(
      "apply-1"
    );
    expect(out).toEqual({
      applied: [{ kind: "update_page", path: "K/x.md" }],
      skipped: []
    });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/tasks/apply-1/result");
  });

  it("getTaskResult 在 status != succeeded 时抛 DikwClientError", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        task_id: "f-1",
        status: "failed",
        started_at: null,
        finished_at: null,
        result: null,
        error: { code: "boom", message: "oh no" }
      })
    );
    const client = new DikwClient({ baseUrl: "http://core.test" });
    await expect(client.getTaskResult("f-1")).rejects.toMatchObject({
      code: "task_not_succeeded"
    });
  });

  it("getTaskResult 区分 cancelled,丢出 task_cancelled 让上层走取消分支", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        task_id: "c-1",
        status: "cancelled",
        started_at: null,
        finished_at: null,
        result: null,
        error: null
      })
    );
    const client = new DikwClient({ baseUrl: "http://core.test" });
    await expect(client.getTaskResult("c-1")).rejects.toMatchObject({
      code: "task_cancelled"
    });
  });

  it("coreId 默认走 baseUrl,允许显式 override(同源代理模式区分上游)", () => {
    expect(new DikwClient({ baseUrl: "http://x:8765" }).coreId).toBe("http://x:8765");
    expect(new DikwClient({ baseUrl: "" }).coreId).toBe("");
    expect(
      new DikwClient({ baseUrl: "", coreId: "http://127.0.0.1:8765" }).coreId
    ).toBe("http://127.0.0.1:8765");
  });

  it("cancelTask POST 到 /v1/tasks/{id}/cancel", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ cancelled: true }));
    const client = new DikwClient({ baseUrl: "http://core.test" });
    await client.cancelTask("t-9");
    const [u, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    expect(new URL(String(u)).pathname).toBe("/v1/tasks/t-9/cancel");
    expect(init.method).toBe("POST");
  });
});

describe("DikwClient.getTask (full row)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("请求 /v1/tasks/{id} 并返回含 result/error 的整行", async () => {
    const row: TaskRow = {
      task_id: "eval-1",
      op: "eval",
      status: "succeeded",
      created_at: "2026-05-20T00:00:00Z",
      started_at: "2026-05-20T00:00:01Z",
      finished_at: "2026-05-20T00:00:05Z",
      params_digest: "d1",
      result: { passed: true },
      error: null
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(row));

    const client = new DikwClient({ baseUrl: "http://core.test" });
    const result = await client.getTask("eval-1");

    expect(result).toEqual(row);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/tasks/eval-1");
  });
});
