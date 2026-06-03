// Shared dotenv primitives for the two sidecar config loaders
// (`server/agent/config.ts` and `server/web/config.ts`). Both read the same
// `.env.local` with identical precedence (explicit env > file value), so the
// parsing/reading helpers live here to keep the two loaders from drifting.

import { readFile } from "node:fs/promises";

/**
 * Read and parse a dotenv file. A missing file is not an error — callers merge
 * the result under `process.env`, so an absent `.env.local` just means "no
 * file-provided values". Any other I/O error propagates.
 */
export async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * Minimal dotenv parser: `KEY=value` lines, `#` comments, blank lines skipped,
 * optional matching single/double quotes stripped. Splits on the first `=` so
 * values may themselves contain `=`.
 */
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

/** Trimmed value for `key`, or undefined when it is unset or blank. */
export function readOptional(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
