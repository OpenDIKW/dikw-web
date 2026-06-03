import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Context-window compaction knobs. The agent runs on ADK's built-in
 * TokenBasedContextCompactor; `tokenThreshold` is derived as
 * `round(contextWindow * ratio)`. See `contextCompactor.ts` for the
 * (important) caveat that ADK's threshold is an aggregate, not the live prompt.
 */
export interface CompactionConfig {
  enabled: boolean;
  /** Model context window in tokens (MiniMax-M3 = 1,048,576). */
  contextWindow: number;
  /** Trigger fraction of the window; 0.5 = "half full". */
  ratio: number;
  /** Min recent raw events kept verbatim (ADK `eventRetentionSize`). */
  retention: number;
}

export interface AgentConfig {
  provider: string;
  api: "anthropic-messages" | "openai-completions";
  apiKey: string;
  baseUrl: string;
  model: string;
  braveApiKey?: string;
  jinaApiKey?: string;
  tavilyApiKey?: string;
  compaction: CompactionConfig;
}

export interface LoadAgentConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export async function loadAgentConfig(options: LoadAgentConfigOptions = {}): Promise<AgentConfig> {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = await readEnvFile(join(cwd, ".env.agent.local"));
  const env = { ...fileEnv, ...(options.env ?? process.env) };
  const apiKey = readRequired(env, "DIKW_AGENT_API_KEY");
  return {
    provider: env.DIKW_AGENT_PROVIDER?.trim() || "minimax",
    api: readApi(env.DIKW_AGENT_API),
    apiKey,
    baseUrl: readRequired(env, "DIKW_AGENT_BASE_URL"),
    model: readRequired(env, "DIKW_AGENT_MODEL"),
    braveApiKey: readOptional(env, "DIKW_AGENT_BRAVE_API_KEY"),
    jinaApiKey: readOptional(env, "DIKW_AGENT_JINA_API_KEY"),
    tavilyApiKey: readOptional(env, "DIKW_AGENT_TAVILY_API_KEY"),
    compaction: {
      enabled: readBoolean(env, "DIKW_AGENT_COMPACTION_ENABLED", true),
      contextWindow: readPositiveNumber(env, "DIKW_AGENT_CONTEXT_WINDOW", 1_048_576),
      ratio: readPositiveNumber(env, "DIKW_AGENT_COMPACTION_RATIO", 0.5),
      retention: readPositiveNumber(env, "DIKW_AGENT_COMPACTION_RETENTION", 8)
    }
  };
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readRequired(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for dikw-web Agent sidecar`);
  }
  return value;
}

function readOptional(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readPositiveNumber(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBoolean(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "false" || value === "0" || value === "no" || value === "off") {
    return false;
  }
  if (value === "true" || value === "1" || value === "yes" || value === "on") {
    return true;
  }
  return fallback;
}

function readApi(value: string | undefined): AgentConfig["api"] {
  if (value === "openai-completions") {
    return value;
  }
  return "anthropic-messages";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
