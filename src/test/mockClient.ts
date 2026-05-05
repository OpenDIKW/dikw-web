import { vi } from "vitest";
import type { DikwClient } from "../api/client";

type AnyMock = ReturnType<typeof vi.fn>;

export type MockDikwClient = DikwClient & {
  get: AnyMock;
  post: AnyMock;
  requestJson: AnyMock;
  streamQuery: AnyMock;
  streamRetrieve: AnyMock;
  streamTaskEvents: AnyMock;
  streamNdjson: AnyMock;
};

export function createMockClient(): MockDikwClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    requestJson: vi.fn(),
    streamQuery: vi.fn(),
    streamRetrieve: vi.fn(),
    streamTaskEvents: vi.fn(),
    streamNdjson: vi.fn()
  } as unknown as MockDikwClient;
}
