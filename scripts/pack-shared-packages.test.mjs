// @vitest-environment node
import assert from "node:assert/strict";
import { it as test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPublishablePackage,
  assertPackedPackage,
  assertCohort,
} from "./pack-shared-packages.mjs";

const pkg = () => ({
  name: "@opendikw/web-client",
  version: "0.1.0-rc.1",
  license: "MIT",
  files: ["dist", "README.md", "LICENSE"],
  dependencies: {},
  exports: { "./core": { types: "./dist/core/index.d.ts", import: "./dist/core/index.js" } },
});
test("rejects private applications and sibling source dependencies", () => {
  assert.throws(() => assertPublishablePackage({ ...pkg(), private: true }), /private/);
  assert.throws(
    () => assertPublishablePackage({ ...pkg(), dependencies: { other: "file:../other" } }),
    /file:/,
  );
  assert.throws(
    () => assertPublishablePackage({ ...pkg(), dependencies: { other: "workspace:*" } }),
    /workspace:/,
  );
});
test("rejects mismatched cohorts and non-exact shared dependencies", () => {
  assert.throws(
    () => assertCohort([pkg(), { ...pkg(), name: "@opendikw/web-ui", version: "0.2.0" }]),
    /versions/,
  );
  assert.throws(
    () => assertPublishablePackage({ ...pkg(), dependencies: { "@opendikw/web-ui": "^0.1.0" } }),
    /exact/,
  );
});
function fixture(contents, check) {
  const cwd = mkdtempSync(join(tmpdir(), "dikw-pack-test-"));
  try {
    for (const [path, value] of Object.entries(contents)) {
      const target = join(cwd, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, value);
    }
    check(
      cwd,
      Object.keys(contents).map((path) => ({ path })),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
const files = () => ({
  "package.json": JSON.stringify(pkg()),
  "README.md": "Shared",
  LICENSE: "MIT",
  "dist/core/index.js": "export const health = 1;",
  "dist/core/index.d.ts": "export declare const health: number;",
});
test("accepts compiled public entries", () =>
  fixture(files(), (cwd, packed) => assertPackedPackage(pkg(), packed, cwd)));

test("does not mistake API paths or document text for module imports", () => {
  const contents = files();
  contents["dist/core/index.js"] = `
    export const endpoint = "/v1/import";
    export const document = "import 'customer-source'";
    // import "uninstalled-comment";
    export function upload(client, form, signal) { return client.post('/v1/import', form, signal); }
    export function next(client) { return client.post('/v1/ingest', {}); }
  `;
  fixture(contents, (cwd, packed) => assertPackedPackage(pkg(), packed, cwd));
});
test("rejects missing declarations and missing stylesheet exports", () => {
  const missing = files();
  delete missing["dist/core/index.d.ts"];
  fixture(missing, (cwd, packed) =>
    assert.throws(() => assertPackedPackage(pkg(), packed, cwd), /missing/),
  );
  fixture(files(), (cwd, packed) =>
    assert.throws(
      () =>
        assertPackedPackage(
          {
            ...pkg(),
            exports: {
              "./reader.css": { types: "./dist/core/index.d.ts", default: "./dist/reader.css" },
            },
          },
          packed,
          cwd,
        ),
      /missing/,
    ),
  );
});
test("rejects sibling imports and undeclared dependencies in compiled code", () => {
  fixture(
    { ...files(), "dist/core/index.js": 'export * from "../../../src/secret.js";' },
    (cwd, packed) => assert.throws(() => assertPackedPackage(pkg(), packed, cwd), /escapes/),
  );
  fixture({ ...files(), "dist/core/index.js": 'import "private-provider";' }, (cwd, packed) =>
    assert.throws(() => assertPackedPackage(pkg(), packed, cwd), /undeclared/),
  );
});
test("rejects customer pages, credentials, databases and test fixtures", () => {
  for (const extra of [
    "dist/mb/MbApp.js",
    "dist/.env",
    "dist/auth.sqlite",
    "dist/fakeIdp.js",
    "dist/core/index.test.js",
  ]) {
    fixture({ ...files(), [extra]: "private" }, (cwd, packed) =>
      assert.throws(() => assertPackedPackage(pkg(), packed, cwd), /Unexpected/),
    );
  }
});
test("rejects missing locally referenced CSS fonts", () => {
  fixture(
    {
      ...files(),
      "dist/reader.css":
        'body { font-family: fixture; } @font-face { src: url("./fonts/missing.woff2"); }',
    },
    (cwd, packed) => assert.throws(() => assertPackedPackage(pkg(), packed, cwd), /missing/),
  );
});
