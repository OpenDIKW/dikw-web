#!/usr/bin/env node
// Bundle-size budget gate. Runs against an existing dist/ (build first), so it
// catches the "a heavy lib crept into the bundle" regression class that
// typecheck and unit tests can't see. Budgets are gzipped KB with deliberate
// headroom over current sizes; raise them as a CONSCIOUS decision (mirroring the
// coverage thresholds in vite.config.ts) — never bump a budget just to make a PR
// pass.
//
// Usage: npm run build && npm run check:bundle   (or node scripts/check-bundle.mjs)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ASSETS = "dist/assets";

// Gzipped-KB ceilings. Baseline (2026-06): entry 250, total JS 1758, CSS 26.
// The total-JS ceiling was raised 1900 → 1950 when the opt-in browser-RUM
// (OpenTelemetry web SDK + zone.js) was added: it is dynamic-import()ed into lazy
// chunks — so it stays OUT of the entry budget and only downloads when a deployment
// enables telemetry in config.json — but check:bundle sums every chunk, so it
// counts here (total moved ~1700 → 1758). Raised deliberately (not to pass — it
// already fit) to restore the pre-RUM headroom margin.
const BUDGET = {
  entryJsGzipKB: 280, // initial page JS (index-*.js) — the bytes users wait on
  totalJsGzipKB: 1950, // all JS incl. lazy mermaid/echarts/cytoscape/telemetry chunks — runaway guard
  cssGzipKB: 35, // hand-rolled tokens; a jump here usually means a UI framework crept in
};

const LABELS = {
  entryJsGzipKB: "entry JS (index-*.js)",
  totalJsGzipKB: "total JS (all chunks)",
  cssGzipKB: "total CSS",
};

function gzipKB(files) {
  const bytes = files.reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(ASSETS, file))).length,
    0,
  );
  return bytes / 1024;
}

let files;
try {
  files = readdirSync(ASSETS);
} catch {
  console.error(`✖ ${ASSETS} not found — run \`npm run build\` first.`);
  process.exit(2);
}

const js = files.filter((file) => file.endsWith(".js"));
const css = files.filter((file) => file.endsWith(".css"));
const entry = js.filter((file) => /^index-.*\.js$/.test(file));
if (entry.length === 0) {
  console.error("✖ no entry chunk (index-*.js) in dist/assets — unexpected build output.");
  process.exit(2);
}

const actual = {
  entryJsGzipKB: gzipKB(entry),
  totalJsGzipKB: gzipKB(js),
  cssGzipKB: gzipKB(css),
};

let failed = false;
for (const key of Object.keys(BUDGET)) {
  const over = actual[key] > BUDGET[key];
  if (over) failed = true;
  console.log(
    `${over ? "✖" : "✓"} ${LABELS[key]}: ${actual[key].toFixed(1)} KB gzip (budget ${BUDGET[key]} KB)`,
  );
}

if (failed) {
  console.error(
    "\nBundle budget exceeded. Trim the import, or — if the growth is justified — raise the" +
      " budget in scripts/check-bundle.mjs deliberately (don't bump it just to pass).",
  );
  process.exit(1);
}
console.log("\nBundle within budget.");
process.exit(0);
