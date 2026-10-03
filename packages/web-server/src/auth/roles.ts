// Role mapping + the capability matrix for auth mode (issue #200). The server is
// the source of truth for access control; the UI only hides what a role can't do.

export type AuthRole = "viewer" | "editor";

/**
 * Read role names from ID-token claims along `claimPath`: dotted segments, and a
 * `[]` suffix to map over an array (`roles`, `groups`, `realm_access.roles`,
 * `roles[].name`). Role *objects* reached through `[]` are dropped when disabled
 * (`isEnabled: false`) or, with `owner` set, when owned by another organization —
 * Casdoor emits roles as `{ owner, name, isEnabled }`.
 */
export function extractRoles(
  claims: Record<string, unknown>,
  claimPath: string,
  owner?: string,
): string[] {
  let values: unknown[] = [claims];
  for (const segment of claimPath.split(".")) {
    const mapsArray = segment.endsWith("[]");
    const name = mapsArray ? segment.slice(0, -2) : segment;
    values = values.flatMap((value) => (isRecord(value) ? [value[name]] : []));
    if (mapsArray) {
      values = values.flatMap((value) =>
        Array.isArray(value) ? value.filter((item) => keepRoleItem(item, owner)) : [],
      );
    }
  }
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
    return [];
  });
}

function keepRoleItem(item: unknown, owner: string | undefined): boolean {
  if (!isRecord(item)) return true;
  if (item.isEnabled === false) return false;
  return owner === undefined || item.owner === owner;
}

/** Editor implies viewer; a user matching neither mapping has no access. */
export function resolveRole(
  roles: string[],
  mapping: { viewerRoles: string[]; editorRoles: string[] },
): AuthRole | null {
  if (roles.some((role) => mapping.editorRoles.includes(role))) return "editor";
  if (roles.some((role) => mapping.viewerRoles.includes(role))) return "viewer";
  return null;
}

// Core writes a viewer may make. Everything else that isn't a safe method needs
// editor, so a new core write endpoint is denied to viewers by default.
const VIEWER_CORE_WRITES = new Set(["/v1/retrieve", "/v1/doc/search"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Minimum role for a request. Paths are split on `/` with empty segments dropped
 * — the same normalization the `/agent` and `/web` handlers route by — so a
 * `//` or trailing-slash variant can't slip a write past the check.
 */
export function requiredRole(method: string, pathname: string): AuthRole {
  const verb = method.toUpperCase();
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "web" && parts[1] === "mineru") {
    return "editor";
  }
  if (parts[0] === "agent") {
    const confirmsProposal =
      parts[1] === "sessions" && parts[3] === "proposals" && parts[5] === "confirm";
    return confirmsProposal && !SAFE_METHODS.has(verb) ? "editor" : "viewer";
  }
  if (pathname.startsWith("/v1/") && !SAFE_METHODS.has(verb)) {
    return VIEWER_CORE_WRITES.has(pathname) ? "viewer" : "editor";
  }
  return "viewer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
