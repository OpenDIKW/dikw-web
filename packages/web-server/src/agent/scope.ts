import type { AgentSessionScope } from "@opendikw/web-client/types";

export class InvalidSessionScopeError extends Error {}

export function parseSessionScope(value: unknown): AgentSessionScope {
  const pagePath =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).pagePath
      : undefined;
  if (
    typeof pagePath !== "string" ||
    pagePath.length > 2048 ||
    pagePath.trim() !== pagePath ||
    Array.from(pagePath).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !/^(sources|knowledge|wisdom)\/[^\\%?#]+\.md$/u.test(pagePath) ||
    pagePath.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new InvalidSessionScopeError("scope.pagePath must be a canonical base Markdown path");
  return { pagePath };
}
