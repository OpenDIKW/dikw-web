import {
  LlmAgent,
  Runner,
  StreamingMode,
  getFunctionCalls,
  getFunctionResponses,
  isCompactedEvent,
  stringifyContent,
} from "@google/adk";
import type { DatabaseSessionService, Event } from "@google/adk";
import type { Content } from "@google/genai";
import type { AgentConfig } from "./config.js";
import { createDikwTools } from "./adkTools.js";
import { buildContextCompactor } from "./contextCompactor.js";
import { MiniMaxLlm } from "./minimaxLlm.js";
import type { AdkSessionStore } from "./adkSessionStore.js";
import { proposalFromTool, sourcesFromTool, systemPrompt } from "./runtime.js";
import type { AgentRunner, RunAgentMessageOptions } from "./runtime.js";
import type { AgentStreamEvent } from "../../src/agent/types.js";
import { recordAgentTurnDuration, type TurnOutcome } from "../shared/metrics.js";

const APP_NAME = "dikw-web";
const USER_ID = "demo";

/**
 * Minimal slice of the ADK `Runner` we depend on, so tests can inject a fake
 * runner without constructing the real one (which would touch the LLM/session).
 */
export interface RunnerLike {
  runAsync(params: {
    userId: string;
    sessionId: string;
    newMessage: Content;
    abortSignal?: AbortSignal;
    runConfig?: { streamingMode: StreamingMode };
  }): AsyncGenerator<Event> | AsyncIterable<Event>;
}

interface CreateRunnerParams {
  appName: string;
  agent: LlmAgent;
  sessionService: DatabaseSessionService;
}

export interface AdkAgentRunnerOptions {
  config: AgentConfig;
  store: AdkSessionStore;
  sessionService: DatabaseSessionService;
  /** Test seam: inject a fake runner. Defaults to a real `Runner`. */
  createRunner?: (params: CreateRunnerParams) => RunnerLike;
}

/**
 * Maps a single ADK `Event` into zero or more `AgentStreamEvent`s in the FROZEN
 * NDJSON wire shape the chat UI consumes. Pure + exported for unit testing.
 *
 * Rules (order within the returned array matters for wire correctness):
 *  1. message_delta is emitted ONLY from PARTIAL events that carry text. ADK
 *     partials are incremental chunks; the UI concatenates them.
 *  2. Non-partial events never emit text. This skips both the auto-appended
 *     user message and the final aggregated assistant text (already streamed).
 *  3. Each functionCall → a "running" tool_event (input = args).
 *  4. Each functionResponse → a "succeeded"/"failed" tool_event, then any
 *     sources, then a proposal (if the tool produced one).
 */
export function mapAdkEvent(sessionId: string, event: Event): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];

  // A context-compaction summary event is also yielded onto this live stream by
  // the runner. It is a prompt-building artifact, not a chat turn — never emit
  // it. (The read path filters it in AdkSessionStore.projectMessages; this is
  // the live-path twin, so the "no wire event" guarantee holds by design rather
  // than incidentally on the event being non-partial.)
  if (isCompactedEvent(event)) {
    return events;
  }

  // ADK does not re-throw LLM/transport errors: LlmAgent.runAndHandleError
  // catches them and YIELDS a non-partial event carrying errorCode/errorMessage
  // (no content). Surface it as the wire `error` event the chat UI expects;
  // otherwise the turn would end silently with no assistant text and no error.
  if (typeof event.errorMessage === "string" && event.errorMessage) {
    events.push({
      type: "error",
      sessionId,
      code:
        typeof event.errorCode === "string" && event.errorCode ? event.errorCode : "agent_error",
      message: event.errorMessage,
    });
  }

  if (event.partial === true) {
    const delta = stringifyContent(event);
    if (delta) {
      events.push({ type: "message_delta", sessionId, delta });
    }
  }

  for (const call of getFunctionCalls(event)) {
    events.push({
      type: "tool_event",
      sessionId,
      event: {
        id: call.id ?? "",
        type: "tool_call",
        name: typeof call.name === "string" ? call.name : "",
        status: "running",
        createdAt: isoTimestamp(event),
        input: call.args,
      },
    });
  }

  for (const resp of getFunctionResponses(event)) {
    const failed = isRecord(resp.response) && "error" in resp.response;
    events.push({
      type: "tool_event",
      sessionId,
      event: {
        id: resp.id ?? "",
        type: "tool_call",
        name: typeof resp.name === "string" ? resp.name : "",
        status: failed ? "failed" : "succeeded",
        createdAt: isoTimestamp(event),
        output: resp.response,
        error: failed ? String((resp.response as Record<string, unknown>).error) : undefined,
      },
    });
    const name = typeof resp.name === "string" ? resp.name : "";
    for (const source of sourcesFromTool(name, resp.response)) {
      events.push({ type: "source", sessionId, source });
    }
    const proposal = proposalFromTool(name, resp.response, resp.id);
    if (proposal) {
      events.push({ type: "proposal", sessionId, proposal });
    }
  }

  return events;
}

/**
 * Drives one chat turn on top of the ADK `Runner`, translating ADK `Event`s
 * into `AgentStreamEvent`s via `mapAdkEvent`. The session is assumed to already
 * exist (http.ts creates it through the same shared sessionService); the Runner
 * auto-appends the user message and persists non-partial events, so we never
 * persist manually.
 */
export class AdkAgentRunner implements AgentRunner {
  private readonly config: AgentConfig;
  private readonly store: AdkSessionStore;
  private readonly sessionService: DatabaseSessionService;
  private readonly createRunner: (params: CreateRunnerParams) => RunnerLike;

  constructor(opts: AdkAgentRunnerOptions) {
    this.config = opts.config;
    this.store = opts.store;
    this.sessionService = opts.sessionService;
    this.createRunner = opts.createRunner ?? ((params) => new Runner(params));
  }

  async runMessage({
    sessionId,
    message,
    coreUrl,
    token,
    signal,
    onEvent,
  }: RunAgentMessageOptions): Promise<void> {
    await onEvent({ type: "agent_start", sessionId });

    const startedAt = Date.now();
    let outcome: TurnOutcome = "ok";
    try {
      // Turn setup lives inside the try so a construction-time throw is handled
      // by the same catch as the run loop (non-abort errors rethrow → http.ts
      // emits the wire `error` event).
      const tools = createDikwTools({
        coreUrl,
        token,
        braveApiKey: this.config.braveApiKey,
        jinaApiKey: this.config.jinaApiKey,
        tavilyApiKey: this.config.tavilyApiKey,
        signal,
      });

      // One MiniMaxLlm instance backs both the agent and the compaction
      // summarizer (it is stateless apart from its HTTP client). The turn signal
      // is applied at the model level so the summarizer call — which ADK invokes
      // without a per-call signal — still honors a user Stop.
      const model = new MiniMaxLlm({
        model: this.config.model,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        abortSignal: signal,
      });
      const compactor = buildContextCompactor(model, this.config.compaction);

      const agent = new LlmAgent({
        name: "dikw_agent",
        description: "A helpful knowledge base agent over dikw-core.",
        model,
        instruction: systemPrompt(),
        tools,
        ...(compactor ? { contextCompactors: [compactor] } : {}),
      });

      const runner = this.createRunner({
        appName: APP_NAME,
        agent,
        sessionService: this.sessionService,
      });

      const stream = runner.runAsync({
        userId: USER_ID,
        sessionId,
        newMessage: { role: "user", parts: [{ text: message }] },
        abortSignal: signal,
        runConfig: { streamingMode: StreamingMode.SSE },
      });
      for await (const event of stream) {
        for (const mapped of mapAdkEvent(sessionId, event)) {
          // ADK surfaces LLM/transport failures as a yielded `error` event (not a
          // throw — see mapAdkEvent), so the loop completes normally. Mark the
          // turn failed here, otherwise the turn metric would report it as "ok".
          if (mapped.type === "error") {
            outcome = "error";
          }
          await onEvent(mapped);
        }
      }
    } catch (error) {
      // A throw after the caller aborted is graceful: finalize + close cleanly.
      if (!signal?.aborted) {
        outcome = "error";
        throw error;
      }
      outcome = "aborted";
    } finally {
      recordAgentTurnDuration((Date.now() - startedAt) / 1000, outcome);
    }

    await this.store.finalizeTurn(sessionId);
    await onEvent({ type: "agent_end", sessionId });
  }
}

function isoTimestamp(event: Event): string {
  const ms = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  return new Date(ms).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
