#!/usr/bin/env node
// Reward-hacking gate. The deterministic check the in-loop agent CANNOT fool.
//
// dikw-web's verification (coverage thresholds, bundle budgets, e2e retries) lives
// in editable source files, and the "don't weaken the tests" rule is otherwise just
// prose in CLAUDE.md / fixer.md / review-rubric.md — the weakest possible defense.
// This gate turns that prose into an exit code: it diffs the branch against its merge
// base and FAILS if the verification itself was weakened, unless a human has attached
// a visible, auditable `gate-change` label to the PR.
//
// It guards itself: any edit to this script, the CI workflows, or fixer's forbidden
// list trips `gate-machinery-modified`, so an agent cannot quietly delete a check.
//
// Usage:
//   node scripts/check-gate-integrity.mjs           # compares HEAD against origin/main
//   GATE_BASE_REF=<sha> node scripts/check-gate-integrity.mjs
//   GATE_HAS_OVERRIDE=true ...                       # honor the gate-change label
//
// Pure helpers + evaluateGate() are exported for unit testing; the git plumbing only
// runs when invoked as a CLI.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// --- pure parsers ---------------------------------------------------------------

/**
 * Extract the balanced `{ ... }` block that follows `key` (e.g. `coverage:`).
 * Brace-counting, so it survives nested blocks like `coverage.thresholds`. Returns
 * the block text incl. its braces, or null. Scoping to the coverage block is what
 * stops the `exclude:`/`thresholds:` parsers from matching a *preceding* `test.*`.
 */
export function extractBlock(src, key) {
  if (!src) return null;
  const keyAt = src.indexOf(key);
  if (keyAt === -1) return null;
  const open = src.indexOf("{", keyAt);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** @returns {{statements:number,branches:number,functions:number,lines:number}|null} */
export function parseCoverageThresholds(src) {
  const cov = extractBlock(src, "coverage:");
  if (!cov) return null;
  const block = cov.match(/thresholds:\s*\{([\s\S]*?)\}/);
  if (!block) return null;
  const pick = (key) => {
    const m = block[1].match(new RegExp(`${key}:\\s*(\\d+(?:\\.\\d+)?)`));
    return m ? Number(m[1]) : null;
  };
  const out = {
    statements: pick("statements"),
    branches: pick("branches"),
    functions: pick("functions"),
    lines: pick("lines"),
  };
  return Object.values(out).every((v) => v !== null) ? out : null;
}

/** Number of entries in the **coverage** `exclude: [...]` array (not `test.exclude`). */
export function parseCoverageExcludeCount(src) {
  const cov = extractBlock(src, "coverage:");
  if (!cov) return null;
  const m = cov.match(/exclude:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const entries = m[1].match(/['"`][^'"`]*['"`]/g);
  return entries ? entries.length : 0;
}

/** @returns {{entryJsGzipKB:number,totalJsGzipKB:number,cssGzipKB:number}|null} */
export function parseBundleBudgets(src) {
  if (!src) return null;
  const pick = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*(\\d+(?:\\.\\d+)?)`));
    return m ? Number(m[1]) : null;
  };
  const out = {
    entryJsGzipKB: pick("entryJsGzipKB"),
    totalJsGzipKB: pick("totalJsGzipKB"),
    cssGzipKB: pick("cssGzipKB"),
  };
  return Object.values(out).every((v) => v !== null) ? out : null;
}

/** The CI branch of `retries: process.env.CI ? N : M` (falls back to a bare `retries: N`). */
export function parsePlaywrightCiRetries(src) {
  if (!src) return null;
  const ternary = src.match(/retries:\s*process\.env\.CI\s*\?\s*(\d+)\s*:\s*\d+/);
  if (ternary) return Number(ternary[1]);
  const bare = src.match(/retries:\s*(\d+)/);
  return bare ? Number(bare[1]) : null;
}

const SKIP_MARKER_RE =
  /(?:\b(?:it|test|describe)\.(?:skip|only|todo)\b)|(?:\b(?:xit|xdescribe|xtest)\b)/g;

/** Count of `.skip`/`.only`/`.todo` and `xit`/`xdescribe` test-disabling markers. */
export function countSkipMarkers(src) {
  if (!src) return 0;
  return (src.match(SKIP_MARKER_RE) || []).length;
}

// Strip line and block comments so commenting code out is not a way to hide an assertion.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Count of `expect(` assertion calls, ignoring commented-out ones. */
export function countAssertions(src) {
  if (!src) return 0;
  return (stripComments(src).match(/\bexpect\s*\(/g) || []).length;
}

const MACHINERY_PATHS = new Set(["scripts/check-gate-integrity.mjs", ".claude/agents/fixer.md"]);

/**
 * Is `path` part of the gate's own enforcement machinery (any edit needs the label)?
 * Note `scripts/check-bundle.mjs` is deliberately NOT here: it is a *checked* file
 * guarded directionally (a raised budget is flagged, a lowered one allowed), exactly
 * like `vite.config.ts` — so tightening a budget doesn't require the gate-change label.
 */
export function isMachineryPath(path) {
  return MACHINERY_PATHS.has(path) || path.startsWith(".github/workflows/");
}

// --- pure evaluation ------------------------------------------------------------

/**
 * Decide whether a change weakens the verification.
 * @param {{
 *   coverage: {base: string|null, head: string|null},
 *   bundle: {base: string|null, head: string|null},
 *   retries: {base: string|null, head: string|null},
 *   modifiedTests: Array<{path: string, base: string|null, head: string|null}>,
 *   deletedTests: string[],
 *   machineryTouched: string[],
 *   hasOverrideLabel: boolean,
 * }} input
 * @returns {{ok: boolean, overridden: boolean, violations: Array<{code: string, file: string, detail: string}>}}
 */
export function evaluateGate(input) {
  const violations = [];

  // (a) coverage thresholds must not drop; the exclude list must not grow.
  const baseCov = parseCoverageThresholds(input.coverage?.base);
  const headCov = parseCoverageThresholds(input.coverage?.head);
  if (baseCov && !headCov) {
    // Removing the thresholds block (or any key) disables Vitest coverage
    // enforcement entirely — the exact weakening this gate exists to catch.
    violations.push({
      code: "coverage-threshold-lowered",
      file: "vite.config.ts",
      detail: "coverage thresholds block removed or no longer parseable",
    });
  } else if (baseCov && headCov) {
    for (const key of Object.keys(baseCov)) {
      if (headCov[key] < baseCov[key]) {
        violations.push({
          code: "coverage-threshold-lowered",
          file: "vite.config.ts",
          detail: `${key}: ${baseCov[key]} → ${headCov[key]}`,
        });
      }
    }
  }
  const baseExcl = parseCoverageExcludeCount(input.coverage?.base);
  const headExcl = parseCoverageExcludeCount(input.coverage?.head);
  if (baseExcl !== null && headExcl !== null && headExcl > baseExcl) {
    violations.push({
      code: "coverage-exclude-grown",
      file: "vite.config.ts",
      detail: `coverage exclude entries: ${baseExcl} → ${headExcl}`,
    });
  }

  // (b) bundle budgets must not rise.
  const baseBudget = parseBundleBudgets(input.bundle?.base);
  const headBudget = parseBundleBudgets(input.bundle?.head);
  if (baseBudget && !headBudget) {
    violations.push({
      code: "bundle-budget-raised",
      file: "scripts/check-bundle.mjs",
      detail: "bundle budget block removed or no longer parseable",
    });
  } else if (baseBudget && headBudget) {
    for (const key of Object.keys(baseBudget)) {
      if (headBudget[key] > baseBudget[key]) {
        violations.push({
          code: "bundle-budget-raised",
          file: "scripts/check-bundle.mjs",
          detail: `${key}: ${baseBudget[key]} → ${headBudget[key]}`,
        });
      }
    }
  }

  // (c) e2e retries must not rise (a higher retry count masks new flakes).
  const baseRetries = parsePlaywrightCiRetries(input.retries?.base);
  const headRetries = parsePlaywrightCiRetries(input.retries?.head);
  if (baseRetries !== null && headRetries !== null && headRetries > baseRetries) {
    violations.push({
      code: "e2e-retries-raised",
      file: "playwright.config.ts",
      detail: `CI retries: ${baseRetries} → ${headRetries}`,
    });
  }

  // (d) tests must not be deleted, disabled, or stripped of assertions.
  for (const path of input.deletedTests || []) {
    violations.push({ code: "test-file-deleted", file: path, detail: "test file removed" });
  }
  for (const t of input.modifiedTests || []) {
    // Only an EXISTING test can be weakened; a brand-new file (no base) is new
    // coverage, and its skip markers / assertion count have nothing to compare against.
    if (t.base == null) continue;
    if (countSkipMarkers(t.head) > countSkipMarkers(t.base)) {
      violations.push({
        code: "test-skip-added",
        file: t.path,
        detail: "a skip/only/todo marker was added",
      });
    }
    if (countAssertions(t.head) < countAssertions(t.base)) {
      violations.push({
        code: "test-assertions-removed",
        file: t.path,
        detail: `expect() calls: ${countAssertions(t.base)} → ${countAssertions(t.head)}`,
      });
    }
  }

  // (e) the gate machinery itself must not be edited (direction is undefinable here).
  for (const path of input.machineryTouched || []) {
    violations.push({
      code: "gate-machinery-modified",
      file: path,
      detail: "gate/CI machinery changed",
    });
  }

  const overridden = violations.length > 0 && !!input.hasOverrideLabel;
  return { ok: violations.length === 0 || overridden, overridden, violations };
}

// --- git plumbing (CLI only) ----------------------------------------------------

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function showAtRef(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // file absent at that ref
  }
}

function main() {
  const baseRef = process.env.GATE_BASE_REF || "origin/main";
  const hasOverrideLabel = process.env.GATE_HAS_OVERRIDE === "true";

  // `<base>...HEAD` diffs against the merge base, so unrelated base movement is ignored.
  const range = `${baseRef}...HEAD`;
  const nameStatus = git(["diff", "--name-status", range]).trim();

  const deletedTests = [];
  const modifiedTestPaths = [];
  const machineryTouched = [];
  for (const line of nameStatus ? nameStatus.split("\n") : []) {
    const [status, ...rest] = line.split(/\s+/);
    const path = rest[rest.length - 1];
    if (!path) continue;
    if (isMachineryPath(path)) machineryTouched.push(path);
    if (TEST_FILE_RE.test(path)) {
      // Deleted tests are always a violation. Only in-place MODIFY can weaken an
      // existing test; added (A) files are new coverage, and a rename that also guts a
      // test shows up as a separate D+A (the D trips test-file-deleted).
      if (status.startsWith("D")) deletedTests.push(path);
      else if (status.startsWith("M")) modifiedTestPaths.push(path);
    }
  }

  const mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
  const pair = (path) => ({ base: showAtRef(mergeBase, path), head: showAtRef("HEAD", path) });
  const modifiedTests = modifiedTestPaths.map((path) => ({ path, ...pair(path) }));

  const result = evaluateGate({
    coverage: pair("vite.config.ts"),
    bundle: pair("scripts/check-bundle.mjs"),
    retries: pair("playwright.config.ts"),
    modifiedTests,
    deletedTests,
    machineryTouched,
    hasOverrideLabel,
  });

  if (result.violations.length === 0) {
    console.log("✓ Gate integrity: no verification weakened.");
    process.exit(0);
  }

  const lines = result.violations.map((v) => `  ✖ [${v.code}] ${v.file} — ${v.detail}`);
  if (result.overridden) {
    console.log(
      "⚠ Gate integrity: the following weakenings were ALLOWED by the `gate-change` label:",
    );
    console.log(lines.join("\n"));
    console.log("\nProceeding (override present). This is recorded for audit.");
    process.exit(0);
  }

  console.error("✖ Gate integrity FAILED — the verification itself was weakened:");
  console.error(lines.join("\n"));
  console.error(
    "\nFix the code so the existing checks pass, instead of weakening them. If the change is a" +
      "\ndeliberate, reviewed decision, a maintainer can add the `gate-change` label to the PR.",
  );
  process.exit(1);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
