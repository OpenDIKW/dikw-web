import { vi } from "vitest";
import type { DikwClient } from "../api/client";

type AnyMock = ReturnType<typeof vi.fn>;

export type MockDikwClient = DikwClient & {
  get: AnyMock;
  post: AnyMock;
  requestJson: AnyMock;
  listTasks: AnyMock;
  getTask: AnyMock;
  getTaskResult: AnyMock;
  getTaskFinalEvent: AnyMock;
  streamRetrieve: AnyMock;
  streamTaskEvents: AnyMock;
  streamNdjson: AnyMock;
};

export function createMockClient(coreId = ""): MockDikwClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    requestJson: vi.fn(),
    // Safe defaults so the TasksPage list loader / select-hydrate effect never
    // calls `.then` on undefined; tests override these as needed.
    listTasks: vi.fn().mockResolvedValue({ tasks: [], next_cursor: null, has_more: false }),
    getTask: vi.fn().mockResolvedValue(undefined),
    // WisdomPage save flow polls task events then unwraps the terminal result.
    // Stub both with empty defaults so an unconfigured test doesn't crash.
    getTaskResult: vi.fn(),
    // ImportPage's consumeTask reconciles here only when the event stream
    // drained without a final event; default null so configured streams that
    // already carry a final aren't affected.
    getTaskFinalEvent: vi.fn().mockResolvedValue(null),
    streamRetrieve: vi.fn(),
    streamTaskEvents: vi.fn(),
    streamNdjson: vi.fn(),
    // Stable identifier matching the same-origin proxy default — pages that
    // bind state to ``client.coreId`` need a deterministic value in tests.
    coreId
  } as unknown as MockDikwClient;
}
