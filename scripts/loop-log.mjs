#!/usr/bin/env node
// Lightweight delivery-loop observability. Appends one structured JSON line per event
// to `.loop-log.jsonl` (gitignored) so an autonomous/background loop is diagnosable
// after the fact — which checks ran, how many flaky reruns, how many fixer escalations,
// how many CI-fix rounds. This is the "structured log" half of the loop-engineering
// brakes; it deliberately stops short of an on-disk state protocol (see
// docs/adr/0005-delivery-loop-hardening.md "Excluded").
//
// The `dikw-web-watch-ci` skill calls this at key points. Usage as a CLI:
//   node scripts/loop-log.mjs <event> [detail]
//   LOOP_LOG_FILE=/path/to/log node scripts/loop-log.mjs ci_fail "verify job red"
//
// Pure formatLogLine() + appendLogLine() are exported for testing.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_FILE = ".loop-log.jsonl";

/** Serialize one event to a single JSONL line (newlines in detail are JSON-escaped). */
export function formatLogLine({ ts, event, detail = "" }) {
  return JSON.stringify({ ts, event, detail });
}

/** Append one event as a JSONL line to `file`. */
export function appendLogLine(file, entry) {
  appendFileSync(file, formatLogLine(entry) + "\n");
}

function main() {
  const event = process.argv[2];
  if (!event) {
    console.error("usage: node scripts/loop-log.mjs <event> [detail]");
    process.exit(2);
  }
  const detail = process.argv[3] || "";
  const file = process.env.LOOP_LOG_FILE || DEFAULT_FILE;
  // A real CLI timestamp is fine here (this is a runtime tool, not a replayable
  // workflow script); tests pass `ts` explicitly to stay deterministic.
  appendLogLine(file, { ts: Date.now(), event, detail });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
