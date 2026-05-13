import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface DikwToolsOptions {
  coreUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export function createDikwTools(options: DikwToolsOptions): AgentTool<any>[] {
  const client = new CoreToolClient(options);
  return [
    {
      name: "dikw_health",
      label: "Read DIKW health",
      description: "Read dikw-core health and provider status.",
      parameters: Type.Object({}),
      execute: async () => result(await client.getJson("/v1/health"))
    },
    {
      name: "retrieve_knowledge",
      label: "Retrieve Knowledge",
      description: "Retrieve relevant chunks and page references from dikw-core.",
      parameters: Type.Object({
        q: Type.String({ description: "Question or retrieval query" }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 }))
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { q: string; limit?: number };
        return result(await client.retrieve(params.q, params.limit ?? 10));
      }
    },
    {
      name: "list_pages",
      label: "List Pages",
      description: "List active base pages.",
      parameters: Type.Object({
        layer: Type.Optional(Type.Union([Type.Literal("wiki"), Type.Literal("source"), Type.Literal("all")]))
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { layer?: "wiki" | "source" | "all" };
        return result(
          await client.getJson("/v1/base/pages", {
            active: true,
            ...(params.layer && params.layer !== "all" ? { layer: params.layer } : {})
          })
        );
      }
    },
    {
      name: "read_page",
      label: "Read Page",
      description: "Read a base page body by path.",
      parameters: Type.Object({
        path: Type.String({ description: "Base page path, for example wiki/architecture.md" })
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { path: string };
        return result(await client.getJson(`/v1/base/pages/${encodeURIComponent(params.path)}`));
      }
    },
    {
      name: "page_links",
      label: "Read Page Links",
      description: "Read inbound and outbound links for a base page.",
      parameters: Type.Object({
        path: Type.String(),
        direction: Type.Optional(Type.Union([Type.Literal("in"), Type.Literal("out"), Type.Literal("both")])),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 }))
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { path: string; direction?: string; limit?: number };
        return result(
          await client.getJson(`/v1/base/pages/${encodeURIComponent(params.path)}/links`, {
            direction: params.direction ?? "both",
            limit: params.limit ?? 50
          })
        );
      }
    },
    {
      name: "list_wisdom",
      label: "List Wisdom",
      description: "List wisdom items from dikw-core.",
      parameters: Type.Object({
        status: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { status?: string; kind?: string };
        return result(await client.getJson("/v1/wisdom", params));
      }
    },
    {
      name: "propose_maintenance_action",
      label: "Propose Maintenance",
      description: "Propose a maintenance task. This never executes the task; the user must confirm in the UI.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("ingest"), Type.Literal("synth"), Type.Literal("distill"), Type.Literal("lint_propose")]),
        description: Type.String(),
        params: Type.Optional(Type.Record(Type.String(), Type.Any()))
      }),
      execute: async (_toolCallId, rawParams: unknown) => {
        const params = rawParams as { action: string; description: string; params?: Record<string, unknown> };
        return result({
          proposal: {
            action: params.action,
            description: params.description,
            params: params.params ?? {}
          }
        });
      }
    }
  ];
}

function result(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details).slice(0, 12000) }],
    details
  };
}

class CoreToolClient {
  private readonly fetchImpl: typeof fetch;
  private readonly coreUrl: string;
  private readonly token: string;

  constructor(options: DikwToolsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.coreUrl = options.coreUrl.replace(/\/$/, "");
    this.token = options.token ?? "";
  }

  async getJson(path: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(this.url(path, params), { headers: this.headers(false) });
    return readJsonResponse(response);
  }

  async retrieve(q: string, limit: number): Promise<unknown> {
    const response = await this.fetchImpl(this.url("/v1/retrieve"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ q, limit })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const text = await response.text();
    let finalResult: unknown = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line) as { type?: string; status?: string; result?: unknown; error?: { message?: string } };
      if (event.type === "final") {
        if (event.status === "succeeded") {
          finalResult = event.result;
        } else {
          throw new Error(event.error?.message ?? `retrieve ${event.status ?? "failed"}`);
        }
      }
    }
    return finalResult ?? { chunks: [], page_refs: [] };
  }

  private url(path: string, params?: Record<string, unknown>): string {
    const url = new URL(path, this.coreUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private headers(hasJsonBody: boolean): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json, application/x-ndjson" };
    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
