import assert from "node:assert/strict";
import { DikwClient, decodeNdjsonStream } from "@opendikw/web-client/core";
import { AgentClient } from "@opendikw/web-client/agent";
import { defaultServerUrl } from "@opendikw/web-client/connection";
import { tryOpenDefaultCache } from "@opendikw/web-client/convert";
import { tryOpenDefaultTranslateCache } from "@opendikw/web-client/translate";
import { buildTar, readTar } from "@opendikw/web-client/import";
import { parseMarkdownDocument } from "@opendikw/web-client/document";

assert.equal(typeof globalThis.window, "undefined");
assert.equal(defaultServerUrl, "http://127.0.0.1:8765");
globalThis.fetch = async (input, init) => {
  assert.equal(input, "https://core.invalid/v1/health");
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-token");
  return Response.json({ status: "ok" });
};
assert.deepEqual(
  await new DikwClient({ baseUrl: "https://core.invalid", token: "fixture-token" }).get(
    "/v1/health",
  ),
  { status: "ok" },
);
assert.equal(typeof new AgentClient().listSessions, "function");
assert.equal(await tryOpenDefaultCache(), null);
assert.equal(await tryOpenDefaultTranslateCache(), null);
assert.equal(
  parseMarkdownDocument("---\ntitle: Package\n---\n\n# Package\n\nEvidence").meta.title,
  "Package",
);
const tar = buildTar([
  { archivePath: "sources/paper.md", data: new TextEncoder().encode("# Paper") },
]);
assert.equal(readTar(tar)[0].archivePath, "sources/paper.md");
const stream = new Response('{"event":"start"}\n{"event":"done"}\n').body;
const events = [];
for await (const value of decodeNdjsonStream(stream)) events.push(value);
assert.deepEqual(events, [{ event: "start" }, { event: "done" }]);
await assert.rejects(import("@opendikw/web-client/src/core/client.js"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
