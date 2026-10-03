// Server-side config loader for /web/* endpoints. Independent of the
// agent sidecar's config so mineru can be enabled / disabled
// independently of the chat agent.
//
// Precedence: explicit env > .env.local file. We share the same
// dotenv file with the agent sidecar because that's where the user
// already keeps their other dikw-web secrets.

import { join } from "node:path";
import { readEnvFile, readOptional } from "../shared/env.js";

// Default MiniMax (Anthropic-compatible) endpoint + model for the translator,
// used only when the agent sidecar's DIKW_AGENT_BASE_URL / _MODEL are unset.
export const DEFAULT_TRANSLATOR_BASE_URL = "https://api.minimaxi.com/anthropic";
export const DEFAULT_TRANSLATOR_MODEL = "MiniMax-M3";

export interface WebConfig {
  /** Undefined when no key is configured; the /web/mineru/* routes then
   *  respond with 503 mineru_disabled. */
  mineruApiKey?: string;
  /** The translator reuses the chat agent's LLM credentials (DIKW_AGENT_API_KEY).
   *  Undefined when that key is unset; the /web/translate/* routes then respond
   *  with 503 translate_disabled and the reader hides the AI 翻译 entry. */
  translatorApiKey?: string;
  /** Anthropic-compatible base URL for the translator LLM, sourced from
   *  DIKW_AGENT_BASE_URL. `loadWebConfig` fills the MiniMax default; optional in
   *  the type so hand-built configs (tests) may omit it and the handler falls
   *  back to DEFAULT_TRANSLATOR_BASE_URL. */
  translatorBaseUrl?: string;
  /** Translator model id, sourced from DIKW_AGENT_MODEL; `loadWebConfig` fills
   *  the MiniMax-M3 default. */
  translatorModel?: string;
  /** Max output tokens for one translation call. `loadWebConfig` parses
   *  `DIKW_WEB_TRANSLATOR_MAX_TOKENS`; when unset the `TranslatorClient`
   *  default applies. Raise it for very long documents. This is the one
   *  translator-specific knob — not a credential — so it keeps its own env var. */
  translatorMaxTokens?: number;
}

export interface LoadWebConfigOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export async function loadWebConfig(options: LoadWebConfigOptions = {}): Promise<WebConfig> {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = await readEnvFile(join(cwd, ".env.local"));
  const env = { ...fileEnv, ...(options.env ?? process.env) };
  // The translator reuses the chat agent's MiniMax credentials (DIKW_AGENT_*)
  // rather than a dedicated key: it talks to the same Anthropic-compatible
  // endpoint, so a single set of secrets configures both. Only the per-call
  // output cap stays a translator-specific env var.
  return {
    mineruApiKey: readOptional(env, "DIKW_WEB_MINERU_API_KEY"),
    translatorApiKey: readOptional(env, "DIKW_AGENT_API_KEY"),
    translatorBaseUrl: readOptional(env, "DIKW_AGENT_BASE_URL") ?? DEFAULT_TRANSLATOR_BASE_URL,
    translatorModel: readOptional(env, "DIKW_AGENT_MODEL") ?? DEFAULT_TRANSLATOR_MODEL,
    translatorMaxTokens: parsePositiveInt(readOptional(env, "DIKW_WEB_TRANSLATOR_MAX_TOKENS")),
  };
}

/** Parse a positive integer env value; any non-positive / non-integer / unset
 *  value yields undefined so the client falls back to its own default. */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
