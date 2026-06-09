// Server-side config loader for /web/* endpoints. Independent of the
// agent sidecar's config so mineru can be enabled / disabled
// independently of the chat agent.
//
// Precedence: explicit env > .env.local file. We share the same
// dotenv file with the agent sidecar because that's where the user
// already keeps their other dikw-web secrets.

import { join } from "node:path";
import { readEnvFile, readOptional } from "../shared/env.js";

// Default MiniMax (Anthropic-compatible) endpoint + model for the translator.
// An operator can point DIKW_WEB_TRANSLATOR_BASE_URL / _MODEL at the same MiniMax
// the chat agent uses, or leave them unset to accept these defaults — only the
// API key is required to enable the feature.
export const DEFAULT_TRANSLATOR_BASE_URL = "https://api.minimaxi.com/anthropic";
export const DEFAULT_TRANSLATOR_MODEL = "MiniMax-M3";

export interface WebConfig {
  /** Undefined when no key is configured; the /web/mineru/* routes then
   *  respond with 503 mineru_disabled. */
  mineruApiKey?: string;
  /** Undefined when no key is configured; the /web/translate/* routes then
   *  respond with 503 translate_disabled and the reader hides the AI 翻译 entry. */
  translatorApiKey?: string;
  /** Anthropic-compatible base URL for the translator LLM. `loadWebConfig` fills
   *  the MiniMax default; optional in the type so hand-built configs (tests) may
   *  omit it and the handler falls back to DEFAULT_TRANSLATOR_BASE_URL. */
  translatorBaseUrl?: string;
  /** Translator model id; `loadWebConfig` fills the MiniMax-M3 default. */
  translatorModel?: string;
  /** Max output tokens for one translation call. `loadWebConfig` parses
   *  `DIKW_WEB_TRANSLATOR_MAX_TOKENS`; when unset the `TranslatorClient`
   *  default applies. Raise it for very long documents. */
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
  return {
    mineruApiKey: readOptional(env, "DIKW_WEB_MINERU_API_KEY"),
    translatorApiKey: readOptional(env, "DIKW_WEB_TRANSLATOR_API_KEY"),
    translatorBaseUrl:
      readOptional(env, "DIKW_WEB_TRANSLATOR_BASE_URL") ?? DEFAULT_TRANSLATOR_BASE_URL,
    translatorModel: readOptional(env, "DIKW_WEB_TRANSLATOR_MODEL") ?? DEFAULT_TRANSLATOR_MODEL,
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
