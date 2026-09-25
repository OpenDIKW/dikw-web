// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The project `.npmrc` sets `ignore-scripts=true`: better-sqlite3 loads its bundled
// N-API prebuilt, but `npm ci` reads lockfile metadata that drops its
// `gypfile: false` and would otherwise run a `node-gyp rebuild` that fails without
// python + a C++ toolchain. Skipping *every* install script is only safe while each
// one is known not to matter, so every installed copy's install steps must match
// what was reviewed here. A new package, or a changed script on an upgrade, fails
// the test and has to be reviewed. Keyed by the script rather than the version so
// routine bumps that leave the script alone don't need a re-review.
const IMPLICIT_GYP = "(implicit) node-gyp rebuild";
const REVIEWED = {
  "@google/genai": {
    steps: "preinstall: echo 'preinstall: no-op'",
    why: "no-op",
  },
  "better-sqlite3": {
    steps: IMPLICIT_GYP,
    why: "the bundled prebuilds/ binary loads before any build/ output",
  },
  "cpu-features": {
    steps: "install: node buildcheck.js > buildcheck.gypi && node-gyp rebuild",
    why: "optional native addon for ssh2, which falls back without it",
  },
  esbuild: {
    steps: "postinstall: node install.js",
    why: "only verifies the binary; @esbuild/<platform> arrives as an optional dep",
  },
  fsevents: {
    steps: null, // macOS-only optional dep, absent from other platforms' node_modules
    why: "optional file watcher; chokidar falls back to polling",
  },
  protobufjs: {
    steps: "postinstall: node scripts/postinstall",
    why: "only checks CLI dependency versions",
  },
  ssh2: {
    steps: "install: node install.js",
    why: "tries an optional native crypto binding; pure-JS fallback",
  },
};

const root = join(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

/** The install steps npm would run for the copy at `path`, or null if not on disk. */
function installSteps(path) {
  const pkgPath = join(root, path, "package.json");
  if (!existsSync(pkgPath)) return null;
  const { scripts = {} } = JSON.parse(readFileSync(pkgPath, "utf8"));
  const steps = ["preinstall", "install", "postinstall"]
    .filter((hook) => scripts[hook])
    .map((hook) => `${hook}: ${scripts[hook]}`);
  if (!scripts.preinstall && !scripts.install && existsSync(join(root, path, "binding.gyp"))) {
    steps.push(IMPLICIT_GYP);
  }
  return steps.join(" && ");
}

function copiesWithInstallStep() {
  const copies = [];
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (!path) continue;
    const steps = installSteps(path);
    if (meta.hasInstallScript || steps) {
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      copies.push({ name, version: meta.version, steps });
    }
  }
  return copies;
}

describe("install scripts", () => {
  it("are skipped by the project .npmrc", () => {
    const npmrc = readFileSync(join(root, ".npmrc"), "utf8");
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
  });

  it("only exist on dependencies whose exact steps were reviewed as safe to skip", () => {
    const unreviewed = copiesWithInstallStep()
      .filter(({ name, steps }) => {
        const entry = REVIEWED[name];
        // Not on disk (another platform's optional dep): only the name can be checked.
        return !entry || (steps !== null && steps !== entry.steps);
      })
      .map(({ name, version, steps }) => `${name}@${version} → ${steps ?? "(not installed)"}`);
    expect(unreviewed).toEqual([]);
  });
});
