import { describe, expect, it } from "vitest";
import {
  countAssertions,
  countSkipMarkers,
  evaluateGate,
  isMachineryPath,
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
