// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSessionService, LlmAgent, Runner, StreamingMode, isCompactedEvent } from "@google/adk";
import type { Event } from "@google/adk";
import { MiniMaxLlm, type AnthropicLike } from "./minimaxLlm";
import { buildContextCompactor } from "./contextCompactor";
import { AdkSessionStore } from "./adkSessionStore";

const APP = "dikw-web";
const USER = "demo";
const SUMMARY_MARKER = "SUMMARY_MARKER_42";

/**
 * Fake Anthropic transport that records every call's messages and returns a
 * canned text reply with a high `input_tokens` so the token-based compactor
 * trips after a couple of turns. The summarizer call (no system prompt) gets a
 * distinctive reply so we can prove the compaction summary is created, fed back
 * into the prompt, and filtered out of the chat projection.
 */
function makeFakeClient(promptTokens: number): { client: AnthropicLike; calls: Array<{ messages: unknown[]; system?: string }> } {
  const calls: Array<{ messages: unknown[]; system?: string }> = [];
  const client: AnthropicLike = {
    messages: {
      stream(params) {
        calls.push({ messages: params.messages, system: params.system });
        const isSummaryCall = params.system === undefined; // summarizer request carries no system instruction
        const text = isSummaryCall ? SUMMARY_MARKER : "ok";
        const reply = {
          content: [{ type: "text", text }],
          usage: { input_tokens: promptTokens, output_tokens: 2 },
          stop_reason: "end_turn"
        };
        // eslint-disable-next-line require-yield
        async function* iterate() {}
        return Object.assign(iterate(), { finalMessage: async () => reply });
      }
    }
  };
  return { client, calls };
}

async function runTurn(runner: Runner, sessionId: string, text: string): Promise<void> {
  const stream = runner.runAsync({
    userId: USER,
    sessionId,
    newMessage: { role: "user", parts: [{ text }] },
    runConfig: { streamingMode: StreamingMode.SSE }
  });
  // Drain the stream so the turn completes and its events are persisted.
  for await (const _event of stream) {
    void _event;
  }
}

describe("context compaction (end-to-end through the real ADK Runner)", () => {
  it("fires compaction, rebuilds the prompt from the summary, and hides the summary from chat history", async () => {
    const { client, calls } = makeFakeClient(1000); // window 100 * 0.5 => threshold 50; 1000 trips it fast
    const model = new MiniMaxLlm({ model: "MiniMax-M3", apiKey: "k", baseUrl: "https://example.invalid", client });
    const compactor = buildContextCompactor(model, { enabled: true, contextWindow: 100, ratio: 0.5, retention: 1 });
    expect(compactor).toBeDefined();

    const agent = new LlmAgent({
      name: "dikw_agent",
      description: "test agent",
      model,
      instruction: "system instruction",
      tools: [],
      contextCompactors: [compactor!]
    });

    const sessionService = new DatabaseSessionService("sqlite://:memory:");
    const session = await sessionService.createSession({ appName: APP, userId: USER, state: {} });
    const runner = new Runner({ appName: APP, agent, sessionService });

    await runTurn(runner, session.id, "first question");
    await runTurn(runner, session.id, "second question");
    await runTurn(runner, session.id, "third question");

    const reloaded = await sessionService.getSession({ appName: APP, userId: USER, sessionId: session.id });

    // 1. A CompactedEvent was created and persisted, carrying the summary text.
    const compactedEvents = reloaded!.events.filter((e: Event) => isCompactedEvent(e));
    expect(compactedEvents.length).toBeGreaterThan(0);
    expect(JSON.stringify(compactedEvents[0].content)).toContain(SUMMARY_MARKER);

    // 2. A later model call had its prompt rebuilt as [summary, ...recent] — the
    //    summary marker reaches the LLM via the "[Previous Context Summary]" wrapper.
    const promptCarriedSummary = calls.some((c) => {
      const serialized = JSON.stringify(c.messages);
      return serialized.includes("Previous Context Summary") && serialized.includes(SUMMARY_MARKER);
    });
    expect(promptCarriedSummary).toBe(true);

    // 3. The summary never renders as a chat message.
    const store = new AdkSessionStore({ sessionService, appName: APP, userId: USER });
    const projected = await store.getSession(session.id);
    expect(projected.messages.some((m) => m.content.includes(SUMMARY_MARKER))).toBe(false);
    expect(projected.messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
  });
});
