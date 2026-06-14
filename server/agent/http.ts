import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSessionService } from "@google/adk";
import { loadAgentConfig } from "./config.js";
import { parseSessionTitle, SESSION_TITLE_ERROR_MESSAGES } from "./sessionStore.js";
import { AdkSessionStore } from "./adkSessionStore.js";
import { AdkAgentRunner } from "./adkRunner.js";
import { SpanStore } from "./spanStore.js";
import { initAgentTelemetry } from "./telemetry.js";
import type { AgentRunner } from "./runtime.js";
import type { AgentMaintenanceAction, AgentStreamEvent } from "../../src/agent/types.js";

export interface AgentHandlerOptions {
  cwd?: string;
  store?: AdkSessionStore;
  runner?: AgentRunner;
  spanStore?: SpanStore;
  sessionsDir?: string;
}

export function resolveSessionsDir(cwd: string, override?: string): string {
  const raw = (override ?? process.env.DIKW_AGENT_SESSIONS_DIR ?? "").trim();
  if (raw) {
    return isAbsolute(raw) ? raw : join(cwd, raw);
  }
  return join(cwd, ".agent-sessions");
}

export async function createDefaultAgentHandler(
  cwd = process.cwd(),
  options: { sessionsDir?: string } = {},
) {
  const config = await loadAgentConfig({ cwd });
  const dir = resolveSessionsDir(cwd, options.sessionsDir);
  await mkdir(dir, { recursive: true }); // sqlite3 creates the file, not the dir
  // POSIX slashes — Windows backslashes break the sqlite:// URI parse.
  const dbUri = `sqlite://${dir.replace(/\\/g, "/")}/agent.sqlite`;
  const sessionService = new DatabaseSessionService(dbUri);
  const store = new AdkSessionStore({ sessionService, appName: "dikw-web", userId: "demo" });
  // Register telemetry BEFORE building the runner so the first turn's spans are
  // captured; initAgentTelemetry owns the process-global SpanStore (see
  // telemetry.ts) so a dev /web request before any /agent request still
  // registers the provider, and #trace reads from this same store.
  const spanStore = initAgentTelemetry();
  const runner = new AdkAgentRunner({ config, store, sessionService });
  return createAgentHandler({ cwd, store, runner, spanStore });
}

export function createAgentHandler(options: AgentHandlerOptions = {}) {
  const { store, runner, spanStore } = options;
  if (!store || !runner) {
    throw new Error(
      "createAgentHandler requires both store and runner (use createDefaultAgentHandler)",
    );
  }
  const activeControllers = new Map<string, AbortController>();

  return async function agentHandler(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (error?: unknown) => void,
  ) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "sessions") {
        return notFound(res);
      }
      if (req.method === "GET" && parts.length === 1) {
        return json(res, await store.listSessions());
      }
      if (req.method === "POST" && parts.length === 1) {
        return json(res, await store.createSession(), 201);
      }
      const sessionId = parts[1];
      if (!sessionId) {
        return notFound(res);
      }
      if (req.method === "GET" && parts.length === 2) {
        return json(res, await store.getSession(sessionId));
      }
      if (req.method === "GET" && parts.length === 3 && parts[2] === "traces") {
        return json(
          res,
          spanStore ? spanStore.getSessionTraces(sessionId) : { sessionId, invocations: [] },
        );
      }
      if (req.method === "PATCH" && parts.length === 2) {
        const body = await readJsonBody(req);
        const parsed = parseSessionTitle(isRecord(body) ? body.title : undefined);
        if (!parsed.ok) {
          return errorJson(
            res,
            400,
            "invalid_request",
            SESSION_TITLE_ERROR_MESSAGES[parsed.reason],
          );
        }
        return json(res, await store.renameSession(sessionId, parsed.title));
      }
      if (req.method === "DELETE" && parts.length === 2) {
        await store.deleteSession(sessionId);
        return noContent(res);
      }
      if (req.method === "POST" && parts.length === 3 && parts[2] === "abort") {
        activeControllers.get(sessionId)?.abort();
        return noContent(res);
      }
      if (req.method === "POST" && parts.length === 3 && parts[2] === "messages") {
        const body = await readJsonBody(req);
        if (!isRecord(body) || typeof body.message !== "string" || !body.message.trim()) {
          return errorJson(res, 400, "invalid_request", "message is required");
        }
        const connection = readCoreConnection(body);
        if ("error" in connection) {
          return errorJson(res, 400, "invalid_request", connection.error);
        }
        const controller = new AbortController();
        activeControllers.set(sessionId, controller);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        const writeEvent = (event: AgentStreamEvent) => {
          res.write(`${JSON.stringify(event)}\n`);
        };
        try {
          await runner.runMessage({
            sessionId,
            message: body.message.trim(),
            coreUrl: connection.coreUrl,
            token: connection.token,
            signal: controller.signal,
            onEvent: writeEvent,
          });
        } catch (error) {
          writeEvent({
            type: "error",
            sessionId,
            code: "agent_error",
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          activeControllers.delete(sessionId);
          res.end();
        }
        return;
      }
      if (req.method === "POST" && parts.length === 5 && parts[2] === "proposals") {
        const proposalId = parts[3];
        if (parts[4] === "reject") {
          return json(res, await store.updateProposalStatus(sessionId, proposalId, "rejected"));
        }
        if (parts[4] === "confirm") {
          const body = await readJsonBody(req);
          const connection = readCoreConnection(body);
          if ("error" in connection) {
            return errorJson(res, 400, "invalid_request", connection.error);
          }
          const session = await store.updateProposalStatus(sessionId, proposalId, "confirmed");
          const proposal = session.proposals.find((item) => item.id === proposalId);
          if (!proposal) {
            return errorJson(res, 404, "not_found", "proposal not found");
          }
          const task = await runMaintenanceProposal(
            proposal.action,
            proposal.params ?? {},
            connection,
          );
          proposal.status = "succeeded";
          proposal.taskId = task.task_id;
          return json(res, await store.recordProposal(sessionId, proposal));
        }
      }
      return notFound(res);
    } catch (error) {
      if (next) {
        next(error);
        return;
      }
      console.error("[agent] unhandled handler error", error);
      return errorJson(res, 500, "agent_http_error", "internal agent error");
    }
  };
}

interface CoreConnection {
  coreUrl: string;
  token?: string;
}

export function maintenanceEndpoint(action: AgentMaintenanceAction): string {
  switch (action) {
    case "ingest":
      return "/v1/ingest";
    case "synth":
      return "/v1/synth";
    case "lint_propose":
      return "/v1/lint/propose";
    default: {
      // Reject unknown actions (e.g. a `distill` proposal persisted before it was
      // removed) instead of silently falling through to lint.propose.
      const unreachable: never = action;
      throw new Error(`unknown maintenance action: ${String(unreachable)}`);
    }
  }
}

async function runMaintenanceProposal(
  action: AgentMaintenanceAction,
  params: Record<string, unknown>,
  connection: CoreConnection,
): Promise<{ task_id?: string }> {
  const endpoint = maintenanceEndpoint(action);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (connection.token) {
    headers.Authorization = `Bearer ${connection.token}`;
  }
  const response = await fetch(`${connection.coreUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as { task_id?: string };
}

function readCoreConnection(body: unknown): CoreConnection | { error: string } {
  if (!isRecord(body) || typeof body.coreUrl !== "string" || !body.coreUrl.trim()) {
    return { error: "coreUrl is required" };
  }
  try {
    const url = new URL(body.coreUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "coreUrl must be an absolute http(s) URL" };
    }
    return {
      coreUrl: url.toString().replace(/\/$/, ""),
      ...(typeof body.token === "string" && body.token ? { token: body.token } : {}),
    };
  } catch {
    return { error: "coreUrl must be an absolute http(s) URL" };
  }
}

function json(res: ServerResponse, value: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

function noContent(res: ServerResponse) {
  res.statusCode = 204;
  res.end();
}

function notFound(res: ServerResponse) {
  errorJson(res, 404, "not_found", "agent route not found");
}

function errorJson(res: ServerResponse, status: number, code: string, message: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { code, message } }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
  }
  return text ? JSON.parse(text) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
