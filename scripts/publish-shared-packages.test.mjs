// @vitest-environment node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it as test } from "vitest";
import { assertReleaseInputs, planPublications } from "./publish-shared-packages.mjs";
const commit = "a".repeat(40);
const bytes = Buffer.from("verified tarball");
const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
const manifest = () => ({
  commit,
  version: "0.1.0-rc.1",
  packages: ["client", "ui", "server"].map((name) => ({
    name: `@opendikw/web-${name}`,
    version: "0.1.0-rc.1",
    tarball: `opendikw-web-${name}-0.1.0-rc.1.tgz`,
    integrity,
  })),
});
const state = () => ({ commit, dirty: "", tag: "next" });
test("requires a clean source commit matching the verified artifact", () => {
  assert.throws(
    () => assertReleaseInputs(manifest(), { ...state(), dirty: " M package.json" }, () => bytes),
    /clean/,
  );
  assert.throws(
    () => assertReleaseInputs(manifest(), { ...state(), commit: "b".repeat(40) }, () => bytes),
    /commit/,
  );
  assert.doesNotThrow(() => assertReleaseInputs(manifest(), state(), () => bytes));
});
test("does not promote prereleases to latest", () => {
  assert.throws(
    () => assertReleaseInputs(manifest(), { ...state(), tag: "latest" }, () => bytes),
    /prerelease/,
  );
  assert.throws(
    () => assertReleaseInputs(manifest(), { ...state(), tag: "custom" }, () => bytes),
    /tag/,
  );
});
test("rejects missing, duplicated and mixed-version package artifacts", () => {
  const missing = manifest();
  missing.packages.pop();
  assert.throws(() => assertReleaseInputs(missing, state(), () => bytes), /three/);
  const duplicate = manifest();
  duplicate.packages[2] = duplicate.packages[1];
  assert.throws(() => assertReleaseInputs(duplicate, state(), () => bytes), /three/);
  const mismatch = manifest();
  mismatch.packages[1].version = "0.2.0";
  assert.throws(() => assertReleaseInputs(mismatch, state(), () => bytes), /version/);
});
test("rejects artifact path traversal and modified bytes", () => {
  const changed = manifest();
  changed.packages[0].tarball = "../secrets.tgz";
  assert.throws(() => assertReleaseInputs(changed, state(), () => bytes), /tarball/);
  assert.throws(
    () => assertReleaseInputs(manifest(), state(), () => Buffer.from("changed")),
    /integrity/,
  );
});
test("retries only unpublished packages after a partial release", () => {
  const published = new Map([["@opendikw/web-client", { integrity, tagVersion: "0.1.0-rc.1" }]]);
  assert.deepEqual(
    planPublications(manifest(), "next", published).map(({ action }) => action),
    ["skip", "publish", "publish"],
  );
});
test("rejects registry versions with different content before publishing anything", () => {
  const published = new Map([
    ["@opendikw/web-server", { integrity: "sha512-different", tagVersion: "0.1.0-rc.1" }],
  ]);
  assert.throws(() => planPublications(manifest(), "next", published), /different content/);
});
test("does not silently retag an existing version", () => {
  assert.throws(
    () =>
      planPublications(
        manifest(),
        "next",
        new Map([["@opendikw/web-client", { integrity, tagVersion: "0.0.9" }]]),
      ),
    /tag/,
  );
});
