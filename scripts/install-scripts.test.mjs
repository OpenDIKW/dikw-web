// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The project `.npmrc` sets `ignore-scripts=true`: better-sqlite3 loads its bundled
// N-API prebuilt, but `npm ci` reads lockfile metadata that drops its
// `gypfile: false` and would otherwise run a `node-gyp rebuild` that fails without
// python + a C++ toolchain. Skipping *every* install script is only safe while each
// dependency that has one is known not to need it — so a new one must be reviewed
// and added here, not silently skipped.
const REVIEWED = {
  "@google/genai": "preinstall is `echo 'preinstall: no-op'`",
  "better-sqlite3": "implicit node-gyp build; the bundled prebuilds/ binary loads first",
  "cpu-features": "optional native addon for ssh2; ssh2 falls back without it",
  esbuild: "postinstall only verifies the binary; @esbuild/<platform> is an optional dep",
  fsevents: "optional, macOS-only file watcher; chokidar falls back to polling",
  protobufjs: "postinstall only checks CLI dependency versions",
  ssh2: "install tries an optional native crypto binding; pure-JS fallback",
};

const root = join(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

function packagesWithInstallStep() {
  const names = new Set();
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (!path) continue;
    const hasGypFile = existsSync(join(root, path, "binding.gyp"));
    if (meta.hasInstallScript || hasGypFile) {
      names.add(path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length));
    }
  }
  return [...names].sort();
}

describe("install scripts", () => {
  it("are skipped by the project .npmrc", () => {
    const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
  });

  it("only exist on dependencies reviewed as not needing them", () => {
    const unreviewed = packagesWithInstallStep().filter((name) => !(name in REVIEWED));
    expect(unreviewed).toEqual([]);
  });
});
