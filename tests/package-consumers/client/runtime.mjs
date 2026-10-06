import assert from "node:assert/strict";
import { DikwClient, decodeNdjsonStream } from "@opendikw/web-client/core";
import { AgentClient } from "@opendikw/web-client/agent";
import { defaultServerUrl } from "@opendikw/web-client/connection";
import { tryOpenDefaultCache } from "@opendikw/web-client/convert";
import { tryOpenDefaultTranslateCache } from "@opendikw/web-client/translate";
import { buildImportBundle, buildTar, kebabStem, readTar } from "@opendikw/web-client/import";
import { extractHeadingsWithSlugs, parseMarkdownDocument } from "@opendikw/web-client/document";

assert.equal(typeof globalThis.window, "undefined");
assert.deepEqual(extractHeadingsWithSlugs("## Results<sup>*</sup>"), [
  { level: 2, title: "Results*", slug: "results" },
]);
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
const longStem = kebabStem("𠀀".repeat(40) + ".pdf");
assert.ok(new TextEncoder().encode(`${longStem}.md`).length <= 100);
const bundle = await buildImportBundle([
  new File(["# Existing path"], "Report.md"),
  new File(["# Fresh path"], "Fresh.md"),
]);
let importPosts = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-token");
  if (init?.method !== "POST") {
    assert.match(input, /\/v1\/base\/pages\?layer=source&active=(true|false)$/);
    return Response.json([
      { path: "sources/report.md", layer: "source", active: false, hash: "old" },
    ]);
  }
  importPosts++;
  const form = init.body;
  assert.deepEqual(
    JSON.parse(form.get("manifest")).packages.map((pkg) => pkg.id),
    [1],
  );
  const raw = new Uint8Array(
    await new Response(
      form.get("payload").stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );
  assert.deepEqual(
    readTar(raw).map((entry) => entry.archivePath),
    ["sources/fresh.md"],
  );
  return Response.json({ committed: [1], rejected: [] });
};
const importClient = new DikwClient({ baseUrl: "https://core.invalid", token: "fixture-token" });
const partial = await importClient.importBundle(bundle.payload, bundle.manifestJson);
assert.deepEqual(partial.committed, [1]);
assert.equal(partial.rejected[0].code, "source_path_exists");
assert.equal(partial.rejected[0].detail.existing_path, "sources/report.md");
const blocked = await buildImportBundle([new File(["# Different paper"], "Report.md")]);
assert.deepEqual(
  (await importClient.importBundle(blocked.payload, blocked.manifestJson)).committed,
  [],
);
assert.equal(importPosts, 1);
const stream = new Response('{"event":"start"}\n{"event":"done"}\n').body;
const events = [];
for await (const value of decodeNdjsonStream(stream)) events.push(value);
assert.deepEqual(events, [{ event: "start" }, { event: "done" }]);
await assert.rejects(import("@opendikw/web-client/src/core/client.js"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
