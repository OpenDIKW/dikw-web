// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { isCompactedEvent } from "@google/adk";
import type { BaseLlm, Event, InvocationContext, LlmResponse } from "@google/adk";
import { buildContextCompactor } from "./contextCompactor";
import type { CompactionConfig } from "./config";

// Plain Event-like object; ADK helpers read genai content.parts / usageMetadata.
function evt(partial: Partial<Event>): Event {
  return partial as Event;
}

function textEvent(text: string, promptTokenCount?: number, timestamp = 1): Event {
  return evt({
    author: "dikw_agent",
    content: { role: "model", parts: [{ text }] },
    timestamp,
    ...(promptTokenCount === undefined ? {} : { usageMetadata: { promptTokenCount } })
  });
}

function ctxWith(events: Event[]): InvocationContext {
  return { session: { events } } as unknown as InvocationContext;
}

/** Minimal BaseLlm whose generateContentAsync is the supplied async generator. */
function fakeLlm(gen: () => AsyncGenerator<LlmResponse, void>): BaseLlm {
  return { generateContentAsync: gen } as unknown as BaseLlm;
}

function config(overrides: Partial<CompactionConfig> = {}): CompactionConfig {
  return { enabled: true, contextWindow: 100, ratio: 0.5, retention: 1, ...overrides };
}

describe("buildContextCompactor", () => {
  it("returns undefined when compaction is disabled", () => {
    const compactor = buildContextCompactor(fakeLlm(async function* () {}), config({ enabled: false }));
    expect(compactor).toBeUndefined();
  });

  it("builds a compactor (threshold = round(window * ratio)) when enabled", () => {
    const compactor = buildContextCompactor(fakeLlm(async function* () {}), config());
    expect(compactor).toBeDefined();
  });

  describe("shouldCompact (ADK TokenBasedContextCompactor, sum of prompt tokens)", () => {
    // window 100 * ratio 0.5 => tokenThreshold 50; retention 1.
    it("is true when summed prompt tokens exceed the threshold and raw events exceed retention", async () => {
      const compactor = buildContextCompactor(fakeLlm(async function* () {}), config())!;
      const ctx = ctxWith([textEvent("a", 40, 1), textEvent("b", 40, 2)]); // sum 80 > 50, 2 > 1
      expect(await compactor.shouldCompact(ctx)).toBe(true);
    });

    it("is false when summed prompt tokens stay under the threshold", async () => {
      const compactor = buildContextCompactor(fakeLlm(async function* () {}), config())!;
      const ctx = ctxWith([textEvent("a", 10, 1), textEvent("b", 10, 2)]); // sum 20 < 50
      expect(await compactor.shouldCompact(ctx)).toBe(false);
    });

    it("is false when raw events do not exceed the retention size", async () => {
      const compactor = buildContextCompactor(fakeLlm(async function* () {}), config())!;
      const ctx = ctxWith([textEvent("a", 80, 1)]); // 1 raw event <= retention 1
      expect(await compactor.shouldCompact(ctx)).toBe(false);
    });
  });

  describe("compact (resilient wrapper)", () => {
    it("appends a CompactedEvent carrying the summary on success", async () => {
      const llm = fakeLlm(async function* () {
        yield { content: { role: "model", parts: [{ text: "SUMMARY" }] } } as LlmResponse;
      });
      const compactor = buildContextCompactor(llm, config({ retention: 1 }))!;
      const events = [textEvent("one", undefined, 1), textEvent("two", undefined, 2), textEvent("three", undefined, 3)];
      const ctx = ctxWith(events);

      await compactor.compact(ctx);

      expect(events).toHaveLength(4);
      const appended = events[events.length - 1];
      expect(isCompactedEvent(appended)).toBe(true);
      expect((appended as { compactedContent?: string }).compactedContent).toBe("SUMMARY");
    });

    it("swallows a summarization failure and leaves the history untouched", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const llm = fakeLlm(async function* () {
        throw new Error("llm down");
      });
      const compactor = buildContextCompactor(llm, config({ retention: 1 }))!;
      const events = [textEvent("one", undefined, 1), textEvent("two", undefined, 2), textEvent("three", undefined, 3)];
      const ctx = ctxWith(events);

      await expect(compactor.compact(ctx)).resolves.toBeUndefined();
      expect(events).toHaveLength(3); // no CompactedEvent pushed
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
