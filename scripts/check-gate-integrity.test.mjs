import { describe, expect, it } from "vitest";
import {
  countAssertions,
  countSkipMarkers,
  evaluateGate,
  isMachineryPath,
  parseGitBatchSources,
  parseBundleBudgets,
  parseCoverageExcludeCount,
  parseCoverageThresholds,
  parsePlaywrightCiRetries,
} from "./check-gate-integrity.mjs";

// Mirrors the real vite.config.ts layout: a top-level `test.exclude` (3 entries)
// appears BEFORE the `coverage` block's own `exclude` (5 entries). The parsers must
// read the coverage block's values, not the first `exclude:`/`thresholds:` they see.
const VITE_CONFIG_SRC = `
    test: {
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/test/**",
          "src/main.tsx",
          "src/types.ts",
          "src/vite-env.d.ts",
        ],
        thresholds: {
          statements: 60,
          branches: 45,
          functions: 55,
          lines: 60,
        },
      },
    },
`;

const COVERAGE_SRC = `
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/test/**",
          "src/main.tsx",
          "src/types.ts",
          "src/vite-env.d.ts",
        ],
        thresholds: {
          statements: 60,
          branches: 45,
          functions: 55,
          lines: 60,
        },
      },
`;

const BUNDLE_SRC = `
const BUDGET = {
  entryJsGzipKB: 280,
  totalJsGzipKB: 1950,
  cssGzipKB: 35,
};
`;

const PLAYWRIGHT_SRC = `
  retries: process.env.CI ? 2 : 0,
`;

describe("parsers", () => {
  it("parses coverage thresholds", () => {
    expect(parseCoverageThresholds(COVERAGE_SRC)).toEqual({
      statements: 60,
      branches: 45,
      functions: 55,
      lines: 60,
    });
  });

  it("counts coverage exclude entries", () => {
    expect(parseCoverageExcludeCount(COVERAGE_SRC)).toBe(5);
  });

  it("parses bundle budgets", () => {
    expect(parseBundleBudgets(BUNDLE_SRC)).toEqual({
      entryJsGzipKB: 280,
      totalJsGzipKB: 1950,
      cssGzipKB: 35,
    });
  });

  it("parses the CI branch of playwright retries", () => {
    expect(parsePlaywrightCiRetries(PLAYWRIGHT_SRC)).toBe(2);
  });

  it("counts skip/only/todo markers", () => {
    const src = `test.skip("a", () => {}); it.only("b", () => {}); xit("c", () => {}); describe.todo("d");`;
    expect(countSkipMarkers(src)).toBe(4);
  });

  it("counts expect() assertions", () => {
    expect(countAssertions(`expect(a).toBe(1); expect(b).toEqual(2);`)).toBe(2);
  });

  it("ignores commented-out assertions", () => {
    expect(countAssertions(`expect(a).toBe(1); // expect(b).toBe(2);`)).toBe(1);
    expect(countAssertions(`expect(a).toBe(1); /* expect(b).toBe(2); */`)).toBe(1);
  });

  it("parses the coverage block's exclude, not a preceding test.exclude", () => {
    // test.exclude (3 entries) precedes coverage.exclude (5 entries) in the real file.
    expect(parseCoverageExcludeCount(VITE_CONFIG_SRC)).toBe(5);
  });

  it("parses coverage thresholds even with a preceding test block", () => {
    expect(parseCoverageThresholds(VITE_CONFIG_SRC)).toEqual({
      statements: 60,
      branches: 45,
      functions: 55,
      lines: 60,
    });
  });

  it("classifies gate machinery paths", () => {
    expect(isMachineryPath("scripts/check-gate-integrity.mjs")).toBe(true);
    expect(isMachineryPath(".github/workflows/ci.yml")).toBe(true);
    expect(isMachineryPath(".claude/agents/fixer.md")).toBe(true);
    // check-bundle.mjs is a CHECKED file (guarded directionally), not machinery —
    // so lowering a budget there does not require the gate-change label.
    expect(isMachineryPath("scripts/check-bundle.mjs")).toBe(false);
    expect(isMachineryPath("src/App.tsx")).toBe(false);
  });
});

describe("evaluateGate", () => {
  const clean = {
    coverage: { base: COVERAGE_SRC, head: COVERAGE_SRC },
    bundle: { base: BUNDLE_SRC, head: BUNDLE_SRC },
    retries: { base: PLAYWRIGHT_SRC, head: PLAYWRIGHT_SRC },
    modifiedTests: [],
    deletedTests: [],
    machineryTouched: [],
    hasOverrideLabel: false,
  };

  it("passes an unrelated change", () => {
    const result = evaluateGate(clean);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a lowered coverage threshold", () => {
    const result = evaluateGate({
      ...clean,
      coverage: {
        base: COVERAGE_SRC,
        head: COVERAGE_SRC.replace("statements: 60", "statements: 50"),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("coverage-threshold-lowered");
  });

  it("flags removing the whole coverage thresholds block (disables enforcement)", () => {
    const noThresholds = COVERAGE_SRC.replace(/thresholds:\s*\{[\s\S]*?\},/, "");
    const result = evaluateGate({
      ...clean,
      coverage: { base: COVERAGE_SRC, head: noThresholds },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("coverage-threshold-lowered");
  });

  it("flags removing a single coverage threshold key", () => {
    const noBranches = COVERAGE_SRC.replace("branches: 45,\n", "");
    const result = evaluateGate({
      ...clean,
      coverage: { base: COVERAGE_SRC, head: noBranches },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("coverage-threshold-lowered");
  });

  it("flags removing the bundle budget block", () => {
    const result = evaluateGate({
      ...clean,
      bundle: { base: BUNDLE_SRC, head: "const BUDGET = {};\n" },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("bundle-budget-raised");
  });

  it("allows raising a coverage threshold", () => {
    const result = evaluateGate({
      ...clean,
      coverage: {
        base: COVERAGE_SRC,
        head: COVERAGE_SRC.replace("statements: 60", "statements: 70"),
      },
    });
    expect(result.ok).toBe(true);
  });

  it("flags a grown coverage exclude list", () => {
    const grown = COVERAGE_SRC.replace(
      `"src/vite-env.d.ts",`,
      `"src/vite-env.d.ts",\n          "src/big-untested.ts",`,
    );
    const result = evaluateGate({ ...clean, coverage: { base: COVERAGE_SRC, head: grown } });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("coverage-exclude-grown");
  });

  it("flags a raised bundle budget", () => {
    const result = evaluateGate({
      ...clean,
      bundle: {
        base: BUNDLE_SRC,
        head: BUNDLE_SRC.replace("entryJsGzipKB: 280", "entryJsGzipKB: 400"),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("bundle-budget-raised");
  });

  it("allows lowering a bundle budget", () => {
    const result = evaluateGate({
      ...clean,
      bundle: {
        base: BUNDLE_SRC,
        head: BUNDLE_SRC.replace("entryJsGzipKB: 280", "entryJsGzipKB: 250"),
      },
    });
    expect(result.ok).toBe(true);
  });

  it("flags raised e2e retries", () => {
    const result = evaluateGate({
      ...clean,
      retries: { base: PLAYWRIGHT_SRC, head: PLAYWRIGHT_SRC.replace("? 2", "? 5") },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("e2e-retries-raised");
  });

  it("flags a deleted test file", () => {
    const result = evaluateGate({ ...clean, deletedTests: ["src/foo.test.ts"] });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("test-file-deleted");
  });

  it("flags an added skip marker", () => {
    const result = evaluateGate({
      ...clean,
      modifiedTests: [
        {
          path: "src/a.test.ts",
          base: `it("x", () => { expect(1).toBe(1); });`,
          head: `it.skip("x", () => { expect(1).toBe(1); });`,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("test-skip-added");
  });

  it("flags removed assertions", () => {
    const result = evaluateGate({
      ...clean,
      modifiedTests: [
        {
          path: "src/a.test.ts",
          base: `expect(1).toBe(1); expect(2).toBe(2);`,
          head: `expect(1).toBe(1);`,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("test-assertions-removed");
  });

  it("allows adding assertions", () => {
    const result = evaluateGate({
      ...clean,
      modifiedTests: [
        {
          path: "src/a.test.ts",
          base: `expect(1).toBe(1);`,
          head: `expect(1).toBe(1); expect(2).toBe(2);`,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("does not flag a brand-new test file that contains skip markers (no base to weaken)", () => {
    const result = evaluateGate({
      ...clean,
      modifiedTests: [
        {
          path: "scripts/gate.test.mjs",
          base: null,
          head: `it.skip("x", () => {}); xit("y", () => {});`,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("flags edits to the gate machinery", () => {
    const result = evaluateGate({ ...clean, machineryTouched: [".github/workflows/ci.yml"] });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("gate-machinery-modified");
  });

  it("allows any violation when the override label is present, marking it overridden", () => {
    const result = evaluateGate({
      ...clean,
      coverage: {
        base: COVERAGE_SRC,
        head: COVERAGE_SRC.replace("statements: 60", "statements: 50"),
      },
      machineryTouched: [".github/workflows/ci.yml"],
      hasOverrideLabel: true,
    });
    expect(result.ok).toBe(true);
    expect(result.overridden).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

function fixtureGitEnv() {
  const env = { ...process.env };
  const count = Number(env.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Invalid fixture Git config count");
  const entries = [
    ["user.name", "Gate fixture"],
    ["user.email", "gate@example.invalid"],
    ["diff.renames", "true"],
  ];
  entries.forEach(([key, value], index) => {
    env["GIT_CONFIG_KEY_" + (count + index)] = key;
    env["GIT_CONFIG_VALUE_" + (count + index)] = value;
  });
  env.GIT_CONFIG_COUNT = String(count + entries.length);
  return env;
}

it.each(["weakened", "preserved", "undiscovered"])("checks actual Git test renames: %s", (mode) => {
  const taskTemp = realpathSync.native(tmpdir());
  const checkout = mkdtempSync(join(taskTemp, "dikw-gate-rename-"));
  const env = fixtureGitEnv();
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: checkout,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git("init", "--quiet");
    const original =
      "// Existing coverage 中文\n".repeat(100) +
      'it("checks behavior", () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n';
    writeFileSync(join(checkout, "original.test.mjs"), original);
    git("add", ".");
    git("commit", "--quiet", "-m", "Baseline test");
    const base = git("rev-parse", "HEAD").trim();
    const renamed = mode === "undiscovered" ? "renamed.txt" : "renamed behavior.test.mjs";
    renameSync(join(checkout, "original.test.mjs"), join(checkout, renamed));
    if (mode === "weakened")
      writeFileSync(join(checkout, renamed), original.replace("  expect(2).toBe(2);\n", ""));
    git("add", ".");
    git("commit", "--quiet", "-m", "Rename test");
    expect(git("diff", "--name-status", base + "...HEAD")).toMatch(/^R\d+/);
    const outcome = spawnSync(process.execPath, [resolve("scripts/check-gate-integrity.mjs")], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...env, GATE_BASE_REF: base, GATE_HAS_OVERRIDE: "false" },
    });
    expect(outcome.status).toBe(mode.endsWith("preserved") ? 0 : 1);
    if (mode === "weakened") expect(outcome.stderr).toContain("test-assertions-removed");
    if (mode === "undiscovered") expect(outcome.stderr).toContain("test-file-deleted");
    expect(readFileSync(join(checkout, renamed), "utf8")).toContain("expect(1)");
  } finally {
    const owned = realpathSync.native(checkout);
    if (owned.startsWith(taskTemp) && owned.includes("dikw-gate-rename-"))
      rmSync(owned, { recursive: true, force: true });
  }
});

it.each([
  "unit-outside",
  "unit-excluded",
  "e2e-outside",
  "preserved",
  "coverage-outside",
  "coverage-preserved",
  "unit-default-excluded",
  "unit-empty-excludes-preserved",
])("checks configured test discovery: %s", (mode) => {
  const taskTemp = realpathSync.native(tmpdir());
  const checkout = mkdtempSync(join(taskTemp, "dikw-gate-discovery-"));
  const env = fixtureGitEnv();
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: checkout,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git("init", "--quiet");
    const source = mode === "e2e-outside" ? "tests/e2e/original.spec.ts" : "src/original.test.ts";
    const target =
      mode === "unit-default-excluded" || mode === "unit-empty-excludes-preserved"
        ? "src/node_modules/pkg/renamed.test.ts"
        : mode.endsWith("preserved")
          ? "src/nested/renamed behavior.test.ts"
          : mode === "unit-excluded"
            ? "src/excluded/renamed.test.ts"
            : "archive/renamed" + (mode === "e2e-outside" ? ".spec.ts" : ".test.ts");
    mkdirSync(join(checkout, dirname(source)), { recursive: true });
    mkdirSync(join(checkout, dirname(target)), { recursive: true });
    writeFileSync(
      join(checkout, "vite.config.ts"),
      mode === "unit-default-excluded" || mode === "unit-empty-excludes-preserved"
        ? 'export default { test: { include: ["src/**/*.{test,spec}.{ts,tsx}"]' +
            (mode.endsWith("preserved") ? ", exclude: []" : "") +
            " } };"
        : mode.startsWith("coverage-")
          ? 'export default { test: { include: ["src/**/*.{test,spec}.{ts,tsx}"], server: { deps: { inline: ["katex"] } }, coverage: { include: ["src/**/*.{ts,tsx}"], exclude: ["**/*.test.{ts,tsx}", "src/test/**"], thresholds: { statements: 60, branches: 45, functions: 55, lines: 60 } } } };'
          : 'export default { test: { include: ["src/**/*.{test,spec}.{ts,tsx}"], exclude: ["src/excluded/**"] } };',
    );
    writeFileSync(
      join(checkout, "playwright.config.ts"),
      'export default { testDir: "./tests/e2e" };',
    );
    writeFileSync(
      join(checkout, source),
      "// Existing coverage 中文\n".repeat(100) + 'it("behavior", () => { expect(1).toBe(1); });\n',
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "Discovered baseline");
    const base = git("rev-parse", "HEAD").trim();
    renameSync(join(checkout, source), join(checkout, target));
    git("add", ".");
    git("commit", "--quiet", "-m", "Rename without changing assertions");
    expect(git("diff", "--name-status", base + "...HEAD")).toMatch(/^R\d+/);
    const result = spawnSync(process.execPath, [resolve("scripts/check-gate-integrity.mjs")], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...env, GATE_BASE_REF: base, GATE_HAS_OVERRIDE: "false" },
    });
    expect(result.status).toBe(mode.endsWith("preserved") ? 0 : 1);
    if (!mode.endsWith("preserved")) expect(result.stderr).toContain("test-file-deleted");
    expect(readFileSync(join(checkout, target), "utf8")).toContain("expect(1)");
  } finally {
    const owned = realpathSync.native(checkout);
    if (owned.startsWith(taskTemp) && owned.includes("dikw-gate-discovery-"))
      rmSync(owned, { recursive: true, force: true });
  }
});

it.each([
  [
    "conditional-live-loss",
    'testDir: live ? "./tests/e2e/live" : "./tests/e2e", testIgnore: live ? undefined : ["**/live/**"]',
    "tests/e2e/live/renamed.spec.ts",
    false,
  ],
  [
    "static-ignore-loss",
    'testDir: "./tests/e2e", testIgnore: ["**/live/**"]',
    "tests/e2e/live/renamed.spec.ts",
    false,
  ],
  [
    "node-modules-loss",
    'testDir: "./tests/e2e"',
    "tests/e2e/node_modules/pkg/renamed.spec.ts",
    false,
  ],
  [
    "node-modules-root-preserved",
    'testDir: "./tests/e2e/node_modules"',
    "tests/e2e/node_modules/nested/renamed.spec.ts",
    true,
    undefined,
    "tests/e2e/node_modules/original.spec.ts",
  ],
  [
    "unknown-env-condition-closed",
    'testDir: "./tests/e2e", testIgnore: process.env.GITHUB_ACTIONS ? ["**/ci-only/**"] : []',
    "tests/e2e/ci-only/renamed.spec.ts",
    false,
    "Unsupported discovery condition",
  ],
  [
    "known-ci-ignore-loss",
    'testDir: "./tests/e2e", testIgnore: process.env.CI ? ["**/ci-only/**"] : []',
    "tests/e2e/ci-only/renamed.spec.ts",
    false,
  ],
  [
    "quoted-ignore-loss",
    'testDir: "./tests/e2e", "testIgnore": ["**/live/**"]',
    "tests/e2e/live/renamed.spec.ts",
    false,
  ],
  [
    "literal-spread-ignore-loss",
    'testDir: "./tests/e2e", ...{ testIgnore: ["**/live/**"] }',
    "tests/e2e/live/renamed.spec.ts",
    false,
  ],
  [
    "unknown-spread-closed",
    'testDir: "./tests/e2e", ...discovery',
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported discovery object spread",
  ],
  [
    "shorthand-closed",
    'testDir: "./tests/e2e", testIgnore',
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported shorthand discovery property",
  ],
  [
    "getter-closed",
    'testDir: "./tests/e2e", get testIgnore() { return ["**/live/**"]; }',
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported accessor discovery property",
  ],
  [
    "indirect-projects-closed",
    'testDir: "./tests/e2e", projects',
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported project-specific test discovery",
    undefined,
    'const projects = [{ testIgnore: ["**/live/**"] }];\nexport default { testDir: "./tests/e2e", projects };',
  ],
  [
    "multi-config-closed",
    "",
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported Playwright config export",
    undefined,
    'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "./tests/e2e" }, { testIgnore: ["**/live/**"] });',
  ],
  [
    "computed-key-closed",
    'testDir: "./tests/e2e", [ignoreKey]: ["**/live/**"]',
    "tests/e2e/live/renamed.spec.ts",
    false,
    "Unsupported computed discovery property",
  ],
  [
    "ordinary-spread-preserved",
    'testDir: live ? "./tests/e2e/live" : "./tests/e2e", testIgnore: live ? undefined : ["**/live/**"], ...(live ? {} : { webServer: { command: "npm run dev" } })',
    "tests/e2e/nested/renamed.spec.ts",
    true,
  ],
  [
    "regex-ignore-loss",
    'testDir: "./tests/e2e", testIgnore: /[/\\\\]live[/\\\\]/',
    "tests/e2e/live/renamed.spec.ts",
    false,
  ],
  [
    "default-branch-preserved",
    'testDir: live ? "./tests/e2e/live" : "./tests/e2e", testIgnore: live ? undefined : ["**/live/**"]',
    "tests/e2e/nested/renamed.spec.ts",
    true,
  ],
  ["default-dir-preserved", "", "nested/renamed.spec.ts", true],
  [
    "empty-match-loss",
    'testDir: "./tests/e2e", testMatch: "**/original.spec.ts"',
    "tests/e2e/renamed.spec.ts",
    false,
  ],
  [
    "custom-match-preserved",
    'testDir: "./tests/e2e", testMatch: ["**/*.spec.ts"]',
    "tests/e2e/renamed.spec.ts",
    true,
  ],
  [
    "hidden-file-loss",
    'testDir: "./tests/e2e"',
    "archive/renamed.spec.ts",
    false,
    "test-file-deleted",
    "tests/e2e/.original.spec.ts",
  ],
  [
    "hidden-directory-loss",
    'testDir: "./tests/e2e"',
    "archive/renamed.spec.ts",
    false,
    "test-file-deleted",
    "tests/e2e/.fixture/original.spec.ts",
  ],
  [
    "hidden-ignore-loss",
    'testDir: "./tests/e2e", testIgnore: ["**/.fixture/**"]',
    "tests/e2e/.fixture/renamed.spec.ts",
    false,
  ],
])(
  "checks default Playwright discovery after a real Git rename: %s",
  (
    _mode,
    config,
    target,
    preserved,
    error = "test-file-deleted",
    source = "tests/e2e/original.spec.ts",
    configuration = 'const live = !!process.env.PLAYWRIGHT_LIVE;\nconst testIgnore = ["**/live/**"];\nexport default { ' +
      config +
      " };",
  ) => {
    const taskTemp = realpathSync.native(tmpdir());
    const checkout = mkdtempSync(join(taskTemp, "dikw-gate-default-discovery-"));
    const env = fixtureGitEnv();
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: checkout,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    try {
      git("init", "--quiet");
      mkdirSync(join(checkout, dirname(source)), { recursive: true });
      mkdirSync(join(checkout, dirname(target)), { recursive: true });
      writeFileSync(
        join(checkout, "vite.config.ts"),
        'export default { test: { include: ["src/**/*.test.ts"] } };',
      );
      writeFileSync(join(checkout, "playwright.config.ts"), configuration);
      writeFileSync(
        join(checkout, source),
        "// Existing coverage 中文\n".repeat(100) +
          'test("behavior", () => { expect(1).toBe(1); });\n',
      );
      git("add", ".");
      git("commit", "--quiet", "-m", "Default discovery baseline");
      const base = git("rev-parse", "HEAD").trim();
      renameSync(join(checkout, source), join(checkout, target));
      git("add", ".");
      git("commit", "--quiet", "-m", "Move unchanged spec");
      expect(git("diff", "--name-status", base + "...HEAD")).toMatch(/^R\d+/);
      const result = spawnSync(process.execPath, [resolve("scripts/check-gate-integrity.mjs")], {
        cwd: checkout,
        encoding: "utf8",
        env: { ...env, GATE_BASE_REF: base, GATE_HAS_OVERRIDE: "false" },
      });
      expect(result.status).toBe(preserved ? 0 : 1);
      if (!preserved) expect(result.stderr).toContain(error);
      expect(readFileSync(join(checkout, target), "utf8")).toContain("expect(1)");
    } finally {
      const owned = realpathSync.native(checkout);
      if (owned.startsWith(taskTemp) && owned.includes("dikw-gate-default-discovery-"))
        rmSync(owned, { recursive: true, force: true });
    }
  },
);

describe("Git batch source protocol", () => {
  it("decodes multibyte bodies and explicit missing paths in order", () => {
    const body = "断言 expect(1)\n";
    const keys = ["HEAD:spaced test.ts", "HEAD:absent.ts"];
    const buffer = Buffer.concat([
      Buffer.from("abc123 blob " + Buffer.byteLength(body) + "\0"),
      Buffer.from(body),
      Buffer.from("\0" + keys[1] + " missing\0"),
    ]);
    expect([...parseGitBatchSources(buffer, keys)]).toEqual([
      [keys[0], body],
      [keys[1], null],
    ]);
  });
  it.each(["header", "body", "unexpected", "trailing"])(
    "rejects invalid Git responses: %s",
    (mode) => {
      const buffers = {
        header: "abc123 blob 1",
        body: "abc123 blob 2\0x\0",
        unexpected: "HEAD:test.ts ambiguous\0",
        trailing: "abc123 blob 1\0x\0extra",
      };
      expect(() => parseGitBatchSources(Buffer.from(buffers[mode]), ["HEAD:test.ts"])).toThrow();
    },
  );
});
