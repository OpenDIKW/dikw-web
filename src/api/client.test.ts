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
});
