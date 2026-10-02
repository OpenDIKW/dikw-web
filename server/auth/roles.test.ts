// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractRoles, requiredRole, resolveRole } from "./roles";

describe("extractRoles", () => {
  it("reads a flat string-array claim", () => {
    expect(extractRoles({ roles: ["a", "b"] }, "roles")).toEqual(["a", "b"]);
    expect(extractRoles({ groups: ["g"] }, "groups")).toEqual(["g"]);
  });

  it("follows a dotted path (Keycloak realm_access.roles)", () => {
    expect(extractRoles({ realm_access: { roles: ["kb_editor"] } }, "realm_access.roles")).toEqual([
      "kb_editor",
    ]);
  });

  it("accepts a single string claim", () => {
    expect(extractRoles({ role: "kb_viewer" }, "role")).toEqual(["kb_viewer"]);
  });

  it("maps over an array of role objects (Casdoor roles[].name)", () => {
    const claims = {
      roles: [
        { owner: "my-org", name: "kb_editor", isEnabled: true },
        { owner: "other-org", name: "kb_viewer" },
      ],
    };
    expect(extractRoles(claims, "roles[].name")).toEqual(["kb_editor", "kb_viewer"]);
  });

  it("filters role objects by owner and drops disabled ones", () => {
    const claims = {
      roles: [
        { owner: "my-org", name: "kb_editor", isEnabled: false },
        { owner: "my-org", name: "kb_viewer", isEnabled: true },
        { owner: "other-org", name: "kb_editor" },
      ],
    };
    expect(extractRoles(claims, "roles[].name", "my-org")).toEqual(["kb_viewer"]);
  });

  it("returns [] for missing or wrongly-shaped claims", () => {
    expect(extractRoles({}, "roles")).toEqual([]);
    expect(extractRoles({ roles: "x" }, "roles[].name")).toEqual([]);
    expect(extractRoles({ roles: [{ name: "a" }] }, "roles")).toEqual([]);
    expect(extractRoles({ realm_access: null }, "realm_access.roles")).toEqual([]);
    expect(extractRoles({ roles: [1, "a", null] }, "roles")).toEqual(["a"]);
  });
});

describe("resolveRole", () => {
  const mapping = { viewerRoles: ["kb_viewer"], editorRoles: ["kb_editor", "admins"] };

  it("editor implies viewer and wins when both match", () => {
    expect(resolveRole(["kb_viewer", "admins"], mapping)).toBe("editor");
  });

  it("maps viewer-only users to viewer", () => {
    expect(resolveRole(["kb_viewer"], mapping)).toBe("viewer");
  });

  it("returns null when no configured role matches", () => {
    expect(resolveRole(["staff"], mapping)).toBeNull();
    expect(resolveRole([], { viewerRoles: [], editorRoles: [] })).toBeNull();
  });
});

describe("requiredRole (issue #200 capability matrix)", () => {
  it.each([
    // Browse / read pages, graph, tasks, retrieve, doc search → viewer
    ["GET", "/"],
    ["GET", "/assets/index.js"],
    ["GET", "/v1/base/pages"],
    ["GET", "/v1/base/graph"],
    ["GET", "/v1/tasks/t-1/events"],
    ["HEAD", "/v1/assets/abc"],
    ["POST", "/v1/retrieve"],
    ["POST", "/v1/doc/search"],
    // Chat with the agent (own sessions), bilingual reading → viewer
    ["GET", "/agent/sessions"],
    ["POST", "/agent/sessions"],
    ["POST", "/agent/sessions/s-1/messages"],
    ["PATCH", "/agent/sessions/s-1"],
    ["DELETE", "/agent/sessions/s-1"],
    ["POST", "/agent/sessions/s-1/abort"],
    ["POST", "/agent/sessions/s-1/proposals/p-1/reject"],
    ["GET", "/web/translate/health"],
    ["POST", "/web/translate/submit"],
    ["GET", "/web/translate/jobs/j-1/result"],
  ])("%s %s → viewer", (method, path) => {
    expect(requiredRole(method, path)).toBe("viewer");
  });

  it.each([
    // Import + document conversion
    ["POST", "/v1/import"],
    ["GET", "/web/mineru/health"],
    ["POST", "/web/mineru/convert"],
    ["GET", "/web/mineru/jobs/j-1/result"],
    ["POST", "//web//mineru/jobs/j-1/cancel"],
    // ingest / synth / eval, lint propose / apply, task cancel, wisdom write
    ["POST", "/v1/ingest"],
    ["POST", "/v1/synth"],
    ["POST", "/v1/eval"],
    ["POST", "/v1/lint/propose"],
    ["POST", "/v1/lint/apply"],
    ["POST", "/v1/tasks/t-1/cancel"],
    ["POST", "/v1/base/wisdom"],
    // Unknown core writes default to editor (allowlist, not denylist).
    ["POST", "/v1/retrieve/"],
    ["DELETE", "/v1/base/pages/x"],
    ["PUT", "/v1/anything"],
    // Confirm an agent maintenance proposal — incl. the path variants the agent
    // handler normalizes the same way (empty segments, trailing slash).
    ["POST", "/agent/sessions/s-1/proposals/p-1/confirm"],
    ["POST", "/agent//sessions/s-1/proposals/p-1/confirm/"],
  ])("%s %s → editor", (method, path) => {
    expect(requiredRole(method, path)).toBe("editor");
  });
});
