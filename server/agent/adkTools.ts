import { FunctionTool } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import {
  CoreToolClient,
  WebToolClient,
  WEB_FETCH_TEXT_BUDGET,
  type DikwToolsOptions
} from "./tools.js";

/**
 * ADK-native variant of the DIKW tool set. Reuses the existing core/web tool
 * clients from `./tools.js`; the difference from the pi `createDikwTools` is the
 * return shape: ADK turns an `execute()` return value directly into
 * `functionResponse.response`, so each tool returns the BARE details object the
 * pi version exposed under `.details` (no `{ content, details }` wrapper).
 *
 * Errors are caught and returned as `{ error: <message> }` so a failed tool
 * yields a `functionResponse` whose `response.error` is set; the projection
 * layer detects a top-level `error` key to mark the tool "failed".
 */
export function createDikwTools(options: DikwToolsOptions): FunctionTool[] {
  const client = new CoreToolClient(options);
  const web = new WebToolClient(options);

  const errorResponse = (error: unknown) => ({
    error: error instanceof Error ? error.message : String(error)
  });

  return [
    new FunctionTool({
      name: "dikw_health",
      description: "Read dikw-core health and provider status.",
      parameters: { type: Type.OBJECT, properties: {} } satisfies Schema,
      execute: async () => {
        try {
          return await client.getJson("/v1/health");
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "retrieve_knowledge",
      description: "Retrieve relevant chunks and page references from dikw-core.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          q: { type: Type.STRING, description: "Question or retrieval query" },
          limit: { type: Type.NUMBER, minimum: 1, maximum: 50 }
        },
        required: ["q"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { q: string; limit?: number };
        try {
          return await client.retrieve(params.q, params.limit ?? 10);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "list_pages",
      description: "List active base pages.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          layer: { type: Type.STRING, format: "enum", enum: ["knowledge", "source", "all"] }
        }
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { layer?: "knowledge" | "source" | "all" };
        try {
          return await client.getJson("/v1/base/pages", {
            active: true,
            ...(params.layer && params.layer !== "all" ? { layer: params.layer } : {})
          });
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "read_page",
      description: "Read a base page body by path.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING, description: "Base page path, for example knowledge/architecture.md" }
        },
        required: ["path"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { path: string };
        try {
          return await client.getJson(`/v1/base/pages/${encodeURIComponent(params.path)}`);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "page_links",
      description: "Read inbound and outbound links for a base page.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          direction: { type: Type.STRING, format: "enum", enum: ["in", "out", "both"] },
          limit: { type: Type.NUMBER, minimum: 1, maximum: 200 }
        },
        required: ["path"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { path: string; direction?: string; limit?: number };
        try {
          return await client.getJson(`/v1/base/pages/${encodeURIComponent(params.path)}/links`, {
            direction: params.direction ?? "both",
            limit: params.limit ?? 50
          });
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "list_wisdom",
      description: "List wisdom items from dikw-core.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          kind: { type: Type.STRING }
        }
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { status?: string; kind?: string };
        try {
          return await client.getJson("/v1/wisdom", params);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "web_search",
      description:
        "Search the public web. Use only when dikw-core retrieval cannot answer (current events, external references).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          q: { type: Type.STRING, description: "Search query" },
          count: { type: Type.NUMBER, minimum: 1, maximum: 10 }
        },
        required: ["q"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { q: string; count?: number };
        try {
          return await web.tavilySearch(params.q, params.count ?? 5);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "web_fetch",
      description:
        "Fetch a web page as markdown via Jina Reader. Pass a full https:// URL, typically from web_search results.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING, description: "Full http(s) URL to fetch" },
          format: { type: Type.STRING, format: "enum", enum: ["markdown", "text"] }
        },
        required: ["url"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { url: string; format?: "markdown" | "text" };
        try {
          const fetched = await web.fetchPage(params.url, params.format ?? "markdown");
          return trimWebFetch(fetched);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }),
    new FunctionTool({
      name: "propose_maintenance_action",
      description: "Propose a maintenance task. This never executes the task; the user must confirm in the UI.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, format: "enum", enum: ["ingest", "synth", "lint_propose"] },
          description: { type: Type.STRING },
          params: { type: Type.OBJECT }
        },
        required: ["action", "description"]
      } satisfies Schema,
      execute: async (input) => {
        const params = input as { action: string; description: string; params?: Record<string, unknown> };
        try {
          return {
            proposal: {
              action: params.action,
              description: params.description,
              params: params.params ?? {}
            }
          };
        } catch (error) {
          return errorResponse(error);
        }
      }
    })
  ];
}

/**
 * Mirrors the pi `webFetchResult` trimming: cap the JSON-encoded `content` so
 * the whole bare-details object stays inside `WEB_FETCH_TEXT_BUDGET`.
 */
function trimWebFetch(fetched: { url: string; content: string; truncated: boolean }) {
  const wrapperLen = JSON.stringify({ ...fetched, content: "" }).length;
  const contentBudget = Math.max(0, WEB_FETCH_TEXT_BUDGET - wrapperLen);
  const trimmedByBudget = fetched.content.length > contentBudget;
  const content = trimmedByBudget ? fetched.content.slice(0, contentBudget) : fetched.content;
  return { url: fetched.url, content, truncated: fetched.truncated || trimmedByBudget };
}
