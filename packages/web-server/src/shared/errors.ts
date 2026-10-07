// What an error was, without what it says (#230). Logs and exported spans use
// this one rule. Neither the message nor `name` is read: both are set at runtime,
// and a provider or upstream error can echo a token, a client secret or a
// credential-bearing URL.

import { getSystemErrorMap } from "node:util";

// A code is kept only when it is a fixed runtime constant — a libuv system error
// name, DNS `ENOTFOUND` or an undici transport code — so it cannot carry a secret.
const KNOWN_ERROR_CODES = new Set([
  ...[...getSystemErrorMap().values()].map(([name]) => name),
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** The class and a known code; a non-Error value is reduced to its type. */
export function safeErrorParts(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: `[${typeof error}]` };
  // The class is a function on the prototype chain, i.e. code. An own `name` or
  // `constructor` is instance data an SDK may have copied from a response body.
  const ctor: unknown = (Object.getPrototypeOf(error) as { constructor?: unknown }).constructor;
  const name = typeof ctor === "function" && ctor.name ? ctor.name : "Error";
  // Node fetch rejects with `TypeError: fetch failed` and puts the reason on
  // `cause`. The walk is bounded because a cause chain can be cyclic.
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
    const { code } = cause as { code?: unknown };
    if (typeof code === "string" && KNOWN_ERROR_CODES.has(code)) return { name, code };
    cause = cause.cause;
  }
  return { name };
}

/** Node-style `Class [CODE]`. */
export function describeError(error: unknown): string {
  const { name, code } = safeErrorParts(error);
  return code ? `${name} [${code}]` : name;
}
