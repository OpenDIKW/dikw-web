// @vitest-environment node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it as test } from "vitest";
import { assertRegistryArtifact } from "./verify-registry-packages.mjs";
const bytes = Buffer.from("verified public package");
const pkg = {
  name: "@opendikw/web-client",
  version: "0.1.0-rc.1",
  integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
};
const metadata = () => ({
  name: pkg.name,
  version: pkg.version,
  dist: {
    integrity: pkg.integrity,
    tarball: "https://registry.npmjs.org/@opendikw/web-client/-/web-client-0.1.0-rc.1.tgz",
  },
});
test("accepts registry bytes identical to the verified candidate", () => {
  assert.doesNotThrow(() => assertRegistryArtifact(pkg, metadata(), bytes));
});
test("rejects mismatched versions, metadata or bytes", () => {
  assert.throws(
    () => assertRegistryArtifact(pkg, { ...metadata(), version: "0.0.9" }, bytes),
    /version/,
  );
  assert.throws(
    () =>
      assertRegistryArtifact(
        pkg,
        { ...metadata(), dist: { ...metadata().dist, integrity: "different" } },
        bytes,
      ),
    /integrity/,
  );
  assert.throws(
    () => assertRegistryArtifact(pkg, metadata(), Buffer.from("modified")),
    /integrity/,
  );
});
test("rejects non-registry download locations", () => {
  for (const tarball of [
    "https://private.invalid/secret",
    "http://registry.npmjs.org/package",
    "https://user:pass@registry.npmjs.org/package",
  ]) {
    assert.throws(
      () =>
        assertRegistryArtifact(
          pkg,
          { ...metadata(), dist: { ...metadata().dist, tarball } },
          bytes,
        ),
      /registry/,
    );
  }
});
