// @vitest-environment node
import assert from "node:assert/strict";
import { it as test } from "vitest";
import { updateSharedVersions } from "./set-shared-version.mjs";
test("updates the release cohort and exact application dependencies together", () => {
  const manifests = [
    {
      name: "dikw-web",
      version: "0.11.0",
      private: true,
      dependencies: { "@opendikw/web-client": "0.1.0", react: "19.2.6" },
    },
    { name: "@opendikw/web-client", version: "0.1.0", dependencies: { other: "1.2.3" } },
    {
      name: "@opendikw/web-ui",
      version: "0.1.0",
      dependencies: { "@opendikw/web-client": "0.1.0" },
    },
    {
      name: "@opendikw/web-server",
      version: "0.1.0",
      dependencies: { "@opendikw/web-client": "0.1.0" },
    },
  ];
  const updated = updateSharedVersions(manifests, "0.1.0-rc.1");
  assert.equal(updated[0].version, "0.11.0");
  assert.equal(updated[0].dependencies["@opendikw/web-client"], "0.1.0-rc.1");
  assert.equal(updated[0].dependencies.react, "19.2.6");
  assert.ok(updated.slice(1).every((pkg) => pkg.version === "0.1.0-rc.1"));
  assert.equal(updated[2].dependencies["@opendikw/web-client"], "0.1.0-rc.1");
  assert.equal(manifests[1].version, "0.1.0");
});
test("rejects incomplete cohorts and non-SemVer inputs", () => {
  assert.throws(() => updateSharedVersions([], "0.1.0-rc.1"), /three/);
  assert.throws(() => updateSharedVersions([], "file:../private"), /version/);
});
