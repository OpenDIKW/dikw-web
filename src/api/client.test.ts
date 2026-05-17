import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DikwClient, buildRequestUrl, normalizeBaseUrl } from "./client";
import type { EventsPage, TaskEvent } from "../types";

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

    const cursors = fetchSpy.mock.calls.map(([input]) =>
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

    fetchSpy.mockImplementation(async (_input, init: RequestInit = {}) => {
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
