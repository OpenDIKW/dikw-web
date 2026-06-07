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
  startIngest: AnyMock;
  startSynth: AnyMock;
  startLintPropose: AnyMock;
  startLintApply: AnyMock;
  cancelTask: AnyMock;
};

// Minimal ``TaskHandle`` for the TasksPage fire-op flow; override per test.
function defaultHandle(op: string) {
  return {
    task_id: `${op}-task`,
    op,
    status: "running",
    created_at: "2026-05-29T00:00:00Z",
    links: {},
  };
}

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
    // TasksPage toolbar fire-ops + detail-panel cancel. Defaults return a
    // running TaskHandle so a fire transitions straight into follow; tests
    // override to assert args or simulate failures.
    startIngest: vi.fn().mockResolvedValue(defaultHandle("ingest")),
    startSynth: vi.fn().mockResolvedValue(defaultHandle("synth")),
    startLintPropose: vi.fn().mockResolvedValue(defaultHandle("lint.propose")),
    startLintApply: vi.fn().mockResolvedValue(defaultHandle("lint.apply")),
    cancelTask: vi.fn().mockResolvedValue({}),
    // Stable identifier matching the same-origin proxy default — pages that
    // bind state to ``client.coreId`` need a deterministic value in tests.
    coreId,
  } as unknown as MockDikwClient;
}
