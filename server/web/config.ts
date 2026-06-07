// Server-side config loader for /web/* endpoints. Independent of the
// agent sidecar's config so mineru can be enabled / disabled
// independently of the chat agent.
//
// Precedence: explicit env > .env.local file. We share the same
// dotenv file with the agent sidecar because that's where the user
// already keeps their other dikw-web secrets.

import { join } from "node:path";
import { readEnvFile, readOptional } from "../shared/env.js";

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
    mineruApiKey: readOptional(env, "DIKW_WEB_MINERU_API_KEY"),
  };
}
