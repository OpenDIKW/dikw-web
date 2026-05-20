import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DikwClient, buildRequestUrl, normalizeBaseUrl } from "./client";
import type { EventsPage, TaskEvent, TaskListPage, TaskRow } from "../types";

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
