// @vitest-environment node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, it as test, vi } from "vitest";
import { assertRegistryArtifact, downloadRegistryArtifact } from "./verify-registry-packages.mjs";
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("waits for newly published registry files and keeps strict transport rules", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("pending", { status: 404 }))
    .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
    .mockResolvedValueOnce(new Response("available"));
  vi.stubGlobal("fetch", fetchMock);
  const pending = downloadRegistryArtifact(metadata().dist.tarball);
  await vi.runAllTimersAsync();
  assert.equal(await (await pending).text(), "available");
  assert.equal(fetchMock.mock.calls.length, 3);
  for (const [, options] of fetchMock.mock.calls) assert.equal(options.redirect, "error");
});
test("bounds registry retries and fails permanent errors immediately", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockImplementation(async () => new Response("pending", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const bounded = assert.rejects(downloadRegistryArtifact(metadata().dist.tarball), /404/);
  await vi.runAllTimersAsync();
  await bounded;
  assert.equal(fetchMock.mock.calls.length, 10);
  fetchMock.mockReset().mockResolvedValue(new Response("forbidden", { status: 403 }));
  await assert.rejects(downloadRegistryArtifact(metadata().dist.tarball), /403/);
  assert.equal(fetchMock.mock.calls.length, 1);
});
