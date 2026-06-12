#!/usr/bin/env node
// Extract one version's section from CHANGELOG.md as GitHub Release notes. Prints
// the body between the `## [<version>]` heading and the next level-2 (`## `)
// heading to stdout, falling back to a one-line note when the version isn't
// documented yet (breaking on any `## ` heading, not just `## [`, stays correct
// even if a release heading is ever written without the `[..]` brackets).
// Used by the `release` job in .github/workflows/ci.yml to feed
// `gh release create --notes-file`.
//
// Usage: node scripts/changelog-notes.mjs <version>   (e.g. 0.3.0)

import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/changelog-notes.mjs <version>");
  process.exit(2);
}

const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));

let body = "";
if (start >= 0) {
  const collected = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    collected.push(lines[i]);
  }
  body = collected.join("\n").trim();
}

const notes = body || `Release ${version}.`;
process.stdout.write(`${notes}\n`);
