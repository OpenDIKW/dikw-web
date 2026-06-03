// Server-side config loader for /web/* endpoints. Independent of the
// agent sidecar's config so mineru can be enabled / disabled
// independently of the chat agent.
//
// Precedence: explicit env > .env.local file. We share the same
// dotenv file with the agent sidecar because that's where the user
// already keeps their other dikw-web secrets.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WebConfig {
  /** Undefined when no key is configured; the /web/mineru/* routes then
   *  respond with 503 mineru_disabled. */
  mineruApiKey?: string;
}

export interface LoadWebConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export async function loadWebConfig(options: LoadWebConfigOptions = {}): Promise<WebConfig> {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = await readEnvFile(join(cwd, ".env.local"));
  const env = { ...fileEnv, ...(options.env ?? process.env) };
  return {
    mineruApiKey: readOptional(env, "DIKW_WEB_MINERU_API_KEY")
  };
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return {};
    throw err;
  }
}

export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readOptional(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
