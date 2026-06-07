import { randomUUID } from "node:crypto";
import { validateAndNormalizeHttpUrl } from "./tools.js";
import type { AgentProposal, AgentSource, AgentStreamEvent } from "../../src/agent/types.js";

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
        score: typeof item.score === "number" ? item.score : null,
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
          kind: "web",
        },
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
        kind: "web" as const,
      },
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

export function proposalFromTool(
  toolName: string,
  details: unknown,
  id?: string,
): AgentProposal | null {
  if (
    toolName !== "propose_maintenance_action" ||
    !isRecord(details) ||
    !isRecord(details.proposal)
  ) {
    return null;
  }
  const action = details.proposal.action;
  if (action !== "ingest" && action !== "synth" && action !== "lint_propose") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: id ?? randomUUID(),
    action,
    title: `Run ${action}`,
    description:
      typeof details.proposal.description === "string"
        ? details.proposal.description
        : `Run ${action}`,
    params: isRecord(details.proposal.params) ? details.proposal.params : {},
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

export function systemPrompt(): string {
  return [
    "You are a helpful knowledge base agent.",
    "dikw-core is the source of truth. Prefer retrieve_knowledge, read_page, page_links, list_wisdom, and dikw_health for any question core can answer.",
    "Use web_search and web_fetch only when core retrieval cannot answer (current events, external references, or explicit user request). Pass full https URLs to web_fetch, ideally from web_search results.",
    "Do not claim that core generated the answer; core returns evidence and you compose the response.",
    "Maintenance actions must be proposed through the maintenance proposal tool and require user confirmation.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
