import { randomUUID } from "node:crypto";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentConfig } from "./config.js";
import { createDikwTools, validateAndNormalizeHttpUrl } from "./tools.js";
import type { FileSessionStore } from "./sessionStore.js";
import type { AgentProposal, AgentSource, AgentStreamEvent, AgentToolEvent } from "../../src/agent/types.js";

export interface RunAgentMessageOptions {
  sessionId: string;
  message: string;
  coreUrl: string;
  token?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
}

export interface AgentRunner {
  runMessage(options: RunAgentMessageOptions): Promise<void>;
}

export interface PiAgentRunnerOptions {
  config: AgentConfig;
  store: FileSessionStore;
}

export class PiAgentRunner implements AgentRunner {
  constructor(private readonly options: PiAgentRunnerOptions) {}

  async runMessage({ sessionId, message, coreUrl, token, signal, onEvent }: RunAgentMessageOptions): Promise<void> {
    const priorSession = await this.options.store.getSession(sessionId);
    await this.options.store.appendUserMessage(sessionId, message);
    await onEvent({ type: "agent_start", sessionId });

    let assistantText = "";
    const agent = new Agent({
      sessionId,
      initialState: {
        systemPrompt: systemPrompt(),
        model: createModel(this.options.config),
        tools: createDikwTools({
          coreUrl,
          token,
          braveApiKey: this.options.config.braveApiKey,
          jinaApiKey: this.options.config.jinaApiKey,
          tavilyApiKey: this.options.config.tavilyApiKey,
          signal
        })
      },
      getApiKey: () => this.options.config.apiKey,
      toolExecution: "sequential"
    });

    (agent.state as { messages: PiAgentMessage[] }).messages = priorSession.messages.map(toPiMessage);
    agent.subscribe(async (event, activeSignal) => {
      if (signal?.aborted || activeSignal.aborted) {
        return;
      }
      const mapped = mapPiEvent(sessionId, event);
      for (const item of mapped.events) {
        if (item.type === "message_delta") {
          assistantText += item.delta;
        }
        await persistEvent(this.options.store, sessionId, item);
        await onEvent(item);
      }
    });

    const abort = () => agent.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(message);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    if (assistantText.trim()) {
      await this.options.store.appendAssistantMessage(sessionId, assistantText.trim());
    }
    await onEvent({ type: "agent_end", sessionId });
  }
}

async function persistEvent(store: FileSessionStore, sessionId: string, event: AgentStreamEvent): Promise<void> {
  if (event.type === "tool_event") {
    await store.recordToolEvent(sessionId, event.event);
  } else if (event.type === "source") {
    await store.recordSource(sessionId, event.source);
  } else if (event.type === "proposal") {
    await store.recordProposal(sessionId, event.proposal);
  }
}

function mapPiEvent(sessionId: string, event: AgentEvent): { events: AgentStreamEvent[] } {
  if (event.type === "message_update") {
    const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string };
    if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
      return { events: [{ type: "message_delta", sessionId, delta: assistantEvent.delta }] };
    }
  }
  if (event.type === "tool_execution_start") {
    return {
      events: [
        {
          type: "tool_event",
          sessionId,
          event: {
            id: event.toolCallId,
            type: "tool_call",
            name: event.toolName,
            status: "running",
            createdAt: new Date().toISOString(),
            input: event.args
          }
        }
      ]
    };
  }
  if (event.type === "tool_execution_end") {
    const details = (event.result as { details?: unknown })?.details;
    const events: AgentStreamEvent[] = [
      {
        type: "tool_event",
        sessionId,
        event: {
          id: event.toolCallId,
          type: "tool_call",
          name: event.toolName,
          status: event.isError ? "failed" : "succeeded",
          createdAt: new Date().toISOString(),
          output: details,
          error: event.isError ? JSON.stringify(details ?? event.result) : undefined
        }
      }
    ];
    for (const source of sourcesFromTool(event.toolName, details)) {
      events.push({ type: "source", sessionId, source });
    }
    const proposal = proposalFromTool(event.toolName, details);
    if (proposal) {
      events.push({ type: "proposal", sessionId, proposal });
    }
    return { events };
  }
  return { events: [] };
}

export function sourcesFromTool(toolName: string, details: unknown): AgentSource[] {
  if (toolName === "retrieve_knowledge") {
    if (!isRecord(details) || !Array.isArray(details.page_refs)) {
      return [];
    }
    return details.page_refs
      .filter(isRecord)
      .map((item) => ({
        path: typeof item.path === "string" ? item.path : "",
        title: typeof item.title === "string" ? item.title : null,
        layer: typeof item.layer === "string" ? item.layer : null,
        score: typeof item.score === "number" ? item.score : null
      }))
      .filter((source) => source.path);
  }
  if (toolName === "web_search") {
    if (!isRecord(details) || !Array.isArray(details.results)) {
      return [];
    }
    return details.results.filter(isRecord).flatMap<AgentSource>((item) => {
      const safeUrl = safeWebUrl(item.url);
      if (!safeUrl) return [];
      return [
        {
          path: safeUrl,
          title: typeof item.title === "string" ? item.title : null,
          excerpt: typeof item.description === "string" ? item.description : null,
          layer: null,
          score: null,
          kind: "web"
        }
      ];
    });
  }
  if (toolName === "web_fetch") {
    if (!isRecord(details)) return [];
    const safeUrl = safeWebUrl(details.url);
    if (!safeUrl) return [];
    return [
      {
        path: safeUrl,
        title: typeof details.title === "string" ? details.title : null,
        excerpt: null,
        layer: null,
        score: null,
        kind: "web" as const
      }
    ];
  }
  return [];
}

function safeWebUrl(value: unknown): string | null {
  try {
    return validateAndNormalizeHttpUrl(value);
  } catch {
    return null;
  }
}

function proposalFromTool(toolName: string, details: unknown): AgentProposal | null {
  if (toolName !== "propose_maintenance_action" || !isRecord(details) || !isRecord(details.proposal)) {
    return null;
  }
  const action = details.proposal.action;
  if (action !== "ingest" && action !== "synth" && action !== "distill" && action !== "lint_propose") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    action,
    title: `Run ${action}`,
    description: typeof details.proposal.description === "string" ? details.proposal.description : `Run ${action}`,
    params: isRecord(details.proposal.params) ? details.proposal.params : {},
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
}

function toPiMessage(message: { role: string; content: string; createdAt: string }): PiAgentMessage {
  return {
    role: message.role as "user" | "assistant",
    content: [{ type: "text", text: message.content }],
    timestamp: new Date(message.createdAt).getTime()
  } as PiAgentMessage;
}

function createModel(config: AgentConfig): Model<"anthropic-messages" | "openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: config.api,
    provider: config.api === "anthropic-messages" ? "anthropic" : "openai",
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  } as Model<"anthropic-messages" | "openai-completions">;
}

function systemPrompt(): string {
  return [
    "You are the OpenDIKW web agent.",
    "dikw-core is the source of truth. Prefer retrieve_knowledge, read_page, page_links, list_wisdom, and dikw_health for any question core can answer.",
    "Use web_search and web_fetch only when core retrieval cannot answer (current events, external references, or explicit user request). Pass full https URLs to web_fetch, ideally from web_search results.",
    "Do not claim that core generated the answer; core returns evidence and you compose the response.",
    "Maintenance actions must be proposed through the maintenance proposal tool and require user confirmation."
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
