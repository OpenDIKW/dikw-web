// @vitest-environment node
import { expect, it } from "vitest";
import { isRequestAllowed } from "@opendikw/web-server/runtime";

it.each([
  ["GET", "/v1/health"],
  ["GET", "/v1/base/pages"],
  ["GET", "/v1/base/pages/sources/paper.md"],
  ["GET", "/v1/base/pages/sources%2Fpaper.md"],
  ["GET", "/v1/base/pages/wiki/page.md/links"],
  ["GET", "/v1/base/wisdom"],
  ["GET", "/v1/wisdom"],
  ["GET", "/v1/assets/papers/image.png"],
  ["POST", "/v1/retrieve"],
  ["POST", "/v1/import"],
  ["POST", "/v1/ingest"],
  ["POST", "/v1/synth"],
  ["POST", "/v1/base/wisdom"],
  ["GET", "/v1/tasks/task-id"],
  ["GET", "/v1/tasks/task-id/events"],
  ["GET", "/v1/tasks/task-id/result"],
  ["GET", "/agent/sessions"],
  ["POST", "/agent/sessions"],
  ["GET", "/agent/sessions/session-id"],
  ["PATCH", "/agent/sessions/session-id"],
  ["DELETE", "/agent/sessions/session-id"],
  ["POST", "/agent/sessions/session-id/messages"],
  ["POST", "/agent/sessions/session-id/abort"],
  ["GET", "/web/auth/me"],
  ["GET", "/web/auth/login"],
  ["GET", "/web/auth/callback"],
  ["GET", "/web/auth/signed-out"],
  ["POST", "/web/auth/logout"],
  ["GET", "/web/mineru/health"],
  ["POST", "/web/mineru/convert"],
  ["POST", "/web/translate/submit"],
  ["GET", "/web/translate/health"],
  ["GET", "/web/translate/jobs/job-id"],
  ["GET", "/web/mineru/jobs/job-id/result"],
  ["POST", "/web/translate/jobs/job-id/cancel"],
])("preserves MB business request %s %s", (method, path) => {
  expect(isRequestAllowed("mbweb", method, path)).toBe(true);
});

it.each([
  ["POST", "/v1/lint/apply"],
  ["POST", "/v1/eval"],
  ["POST", "/v1/distill"],
  ["GET", "/v1/review"],
  ["GET", "/v1/tasks"],
  ["POST", "/v1/tasks/task-id/cancel"],
  ["POST", "/agent/sessions/a/proposals/p/confirm"],
  ["POST", "/agent/sessions/a/proposals/p/reject"],
  ["GET", "/agent/sessions/a/traces"],
  ["POST", "/v1/new-admin-operation"],
  ["GET", "/v1"],
  ["GET", "/web/new-api"],
  ["POST", "/web/translate"],
  ["GET", "/web/auth/new-api"],
  ["GET", "/agent"],
  ["GET", "/v1/%6cint"],
  ["POST", "/agent/sessions/a/%70roposals/p/confirm"],
  ["POST", "/agent/sessions/a/proposals/p/../messages"],
  ["GET", "/v1/base/pages/%252e%252e/secrets"],
  ["GET", "/v1/base/pages/%2e%2e/secrets"],
  ["GET", "/v1/base/pages/%5c..%5csecrets"],
  ["GET", "/v1/base/pages/%invalid"],
  ["GET", "/v1//tasks"],
])("denies MB management or ambiguous request %s %s", (method, path) => {
  expect(isRequestAllowed("mbweb", method, path)).toBe(false);
});

it("leaves the workbench capability matrix compatible", () => {
  expect(isRequestAllowed("workbench", "POST", "/v1/lint/apply")).toBe(true);
  expect(isRequestAllowed("workbench", "GET", "/agent/sessions/a/traces")).toBe(true);
});
