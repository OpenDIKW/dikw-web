// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getFunctionCalls, getFunctionResponses, stringifyContent } from "@google/adk";
import type { Event } from "@google/adk";
import { AdkAgentRunner, mapAdkEvent, type RunnerLike } from "./adkRunner";
import type { AgentConfig } from "./config";
import type { AdkSessionStore } from "./adkSessionStore";
import type { AgentStreamEvent } from "../../src/agent/types";

const SESSION_ID = "session-1";

// Build a plain Event-like object; the real ADK helpers read genai content.parts.
function evt(partial: Partial<Event>): Event {
  return partial as Event;
}

describe("ADK helpers (sanity)", () => {
  it("extracts text/calls/responses from plain content.parts events", () => {
    expect(stringifyContent(evt({ content: { role: "model", parts: [{ text: "Hel" }] } }))).toBe("Hel");
    const call = getFunctionCalls(
      evt({ content: { role: "model", parts: [{ functionCall: { id: "c1", name: "x", args: { a: 1 } } }] } })
    );
    expect(call).toEqual([{ id: "c1", name: "x", args: { a: 1 } }]);
    const resp = getFunctionResponses(
      evt({ content: { role: "user", parts: [{ functionResponse: { id: "c1", name: "x", response: { ok: true } } }] } })
    );
    expect(resp).toEqual([{ id: "c1", name: "x", response: { ok: true } }]);
  });
});

describe("mapAdkEvent", () => {
  it("emits a message_delta for a partial text event", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({ partial: true, content: { role: "model", parts: [{ text: "Hel" }] }, timestamp: 1 })
    );
    expect(out).toEqual([{ type: "message_delta", sessionId: SESSION_ID, delta: "Hel" }]);
  });

  it("emits nothing for a non-partial assistant final text event", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({ partial: false, author: "dikw_agent", content: { role: "model", parts: [{ text: "Final." }] } })
    );
    expect(out).toEqual([]);
  });

  it("emits nothing for the auto-appended user message", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({ author: "user", partial: false, content: { role: "user", parts: [{ text: "hi" }] } })
    );
    expect(out).toEqual([]);
  });

  it("emits a running tool_event for a functionCall part", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({
        content: { role: "model", parts: [{ functionCall: { id: "tc-1", name: "retrieve_knowledge", args: { q: "x" } } }] },
        timestamp: 5
      })
    );
    expect(out).toEqual([
      {
        type: "tool_event",
        sessionId: SESSION_ID,
        event: {
          id: "tc-1",
          type: "tool_call",
          name: "retrieve_knowledge",
          status: "running",
          createdAt: new Date(5).toISOString(),
          input: { q: "x" }
        }
      }
    ]);
  });

  it("emits a succeeded tool_event plus a source for a retrieve_knowledge response", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({
        content: {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "tc-1",
                name: "retrieve_knowledge",
                response: { page_refs: [{ path: "knowledge/a.md", title: "A", layer: "knowledge", score: 0.9 }] }
              }
            }
          ]
        },
        timestamp: 6
      })
    );
    expect(out[0]).toMatchObject({
      type: "tool_event",
      event: { id: "tc-1", name: "retrieve_knowledge", status: "succeeded", error: undefined }
    });
    expect(out[1]).toEqual({
      type: "source",
      sessionId: SESSION_ID,
      source: { path: "knowledge/a.md", title: "A", layer: "knowledge", score: 0.9 }
    });
  });

  it("emits a failed tool_event when the response carries an error", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({
        content: { role: "user", parts: [{ functionResponse: { id: "ws-1", name: "web_search", response: { error: "boom" } } }] }
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "tool_event",
      event: { id: "ws-1", name: "web_search", status: "failed", error: "boom" }
    });
  });

  it("surfaces an ADK error event (errorMessage + errorCode, no content) as a single error event", () => {
    const out = mapAdkEvent(SESSION_ID, evt({ errorMessage: "LLM 500 boom", errorCode: "UNKNOWN_ERROR" }));
    expect(out).toEqual([
      { type: "error", sessionId: SESSION_ID, code: "UNKNOWN_ERROR", message: "LLM 500 boom" }
    ]);
  });

  it("defaults the error code to agent_error when errorCode is absent", () => {
    const out = mapAdkEvent(SESSION_ID, evt({ errorMessage: "network down" }));
    expect(out).toEqual([
      { type: "error", sessionId: SESSION_ID, code: "agent_error", message: "network down" }
    ]);
  });

  it("does not emit an error event for a normal text/partial event", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({ partial: true, content: { role: "model", parts: [{ text: "Hel" }] }, timestamp: 1 })
    );
    expect(out.some((e) => e.type === "error")).toBe(false);
    expect(out).toEqual([{ type: "message_delta", sessionId: SESSION_ID, delta: "Hel" }]);
  });

  it("emits a proposal for a propose_maintenance_action response", () => {
    const out = mapAdkEvent(
      SESSION_ID,
      evt({
        content: {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "pr-1",
                name: "propose_maintenance_action",
                response: { proposal: { action: "ingest", description: "d", params: {} } }
              }
            }
          ]
        }
      })
    );
    const proposal = out.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({ type: "proposal", proposal: { id: "pr-1", action: "ingest" } });
  });
});

function makeConfig(): AgentConfig {
  return {
    provider: "minimax",
    api: "anthropic-messages",
    apiKey: "key",
    baseUrl: "https://example.com",
    model: "MiniMax-M3"
  };
}

function makeRunner(createRunner: () => RunnerLike): {
  runner: AdkAgentRunner;
  finalizeTurn: ReturnType<typeof vi.fn>;
} {
  const finalizeTurn = vi.fn(async () => {});
  const store = { finalizeTurn } as unknown as AdkSessionStore;
  const runner = new AdkAgentRunner({
    config: makeConfig(),
    store,
    sessionService: {} as never,
    createRunner
  });
  return { runner, finalizeTurn };
}

async function collect(
  run: (onEvent: (e: AgentStreamEvent) => void) => Promise<void>
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  await run((e) => {
    events.push(e);
  });
  return events;
}

describe("AdkAgentRunner.runMessage", () => {
  it("streams agent_start, deltas, tool events, then agent_end and finalizes once", async () => {
    const fakeRunner: RunnerLike = {
      // eslint-disable-next-line require-yield
      async *runAsync() {
        yield evt({ author: "user", partial: false, content: { role: "user", parts: [{ text: "hi" }] } });
        yield evt({ partial: true, content: { role: "model", parts: [{ text: "Layered " }] }, timestamp: 1 });
        yield evt({ partial: true, content: { role: "model", parts: [{ text: "answer." }] }, timestamp: 2 });
        yield evt({
          content: {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "tc-1",
                  name: "retrieve_knowledge",
                  response: { page_refs: [{ path: "knowledge/a.md", title: "A", layer: "knowledge", score: 0.9 }] }
                }
              }
            ]
          },
          timestamp: 3
        });
        yield evt({ partial: false, content: { role: "model", parts: [{ text: "Layered answer." }] }, timestamp: 4 });
      }
    };
    const { runner, finalizeTurn } = makeRunner(() => fakeRunner);

    const events = await collect((onEvent) =>
      runner.runMessage({ sessionId: SESSION_ID, message: "hi", coreUrl: "http://127.0.0.1:8765", onEvent })
    );

    expect(events[0]).toEqual({ type: "agent_start", sessionId: SESSION_ID });
    expect(events[events.length - 1]).toEqual({ type: "agent_end", sessionId: SESSION_ID });

    const deltas = events.filter((e) => e.type === "message_delta").map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(["Layered ", "answer."]);
    // The final non-partial "Layered answer." must NOT produce a delta.
    expect(deltas).not.toContain("Layered answer.");

    expect(events.some((e) => e.type === "tool_event" && e.event.status === "succeeded")).toBe(true);
    expect(events.some((e) => e.type === "source")).toBe(true);
    expect(finalizeTurn).toHaveBeenCalledTimes(1);
    expect(finalizeTurn).toHaveBeenCalledWith(SESSION_ID);
  });

  it("treats a throw after abort as graceful: still finalizes + ends, no rethrow", async () => {
    const controller = new AbortController();
    const fakeRunner: RunnerLike = {
      async *runAsync() {
        controller.abort();
        throw new Error("aborted mid-stream");
        // eslint-disable-next-line no-unreachable
        yield evt({});
      }
    };
    const { runner, finalizeTurn } = makeRunner(() => fakeRunner);

    const events = await collect((onEvent) =>
      runner.runMessage({
        sessionId: SESSION_ID,
        message: "hi",
        coreUrl: "http://127.0.0.1:8765",
        signal: controller.signal,
        onEvent
      })
    );

    expect(events[events.length - 1]).toEqual({ type: "agent_end", sessionId: SESSION_ID });
    expect(finalizeTurn).toHaveBeenCalledTimes(1);
  });

  it("rethrows a normal error (no abort)", async () => {
    const fakeRunner: RunnerLike = {
      async *runAsync() {
        throw new Error("boom");
        // eslint-disable-next-line no-unreachable
        yield evt({});
      }
    };
    const { runner, finalizeTurn } = makeRunner(() => fakeRunner);

    await expect(
      runner.runMessage({ sessionId: SESSION_ID, message: "hi", coreUrl: "http://127.0.0.1:8765", onEvent: () => {} })
    ).rejects.toThrow("boom");
    expect(finalizeTurn).not.toHaveBeenCalled();
  });

  it("surfaces an ADK-yielded error event and still ends the turn (no rethrow)", async () => {
    const fakeRunner: RunnerLike = {
      async *runAsync() {
        yield evt({ partial: true, content: { role: "model", parts: [{ text: "Think" }] }, timestamp: 1 });
        yield evt({ partial: true, content: { role: "model", parts: [{ text: "ing..." }] }, timestamp: 2 });
        // ADK catches the LLM/transport failure and YIELDS an error event (no content).
        yield evt({ errorMessage: "network down", timestamp: 3 });
      }
    };
    const { runner, finalizeTurn } = makeRunner(() => fakeRunner);

    const events = await collect((onEvent) =>
      runner.runMessage({ sessionId: SESSION_ID, message: "hi", coreUrl: "http://127.0.0.1:8765", onEvent })
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({ type: "error", message: "network down" });
    // The loop completes normally — nothing is thrown — and still finalizes + ends.
    expect(events[events.length - 1]).toEqual({ type: "agent_end", sessionId: SESSION_ID });
    expect(finalizeTurn).toHaveBeenCalledTimes(1);
  });
});
