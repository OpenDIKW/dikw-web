#!/usr/bin/env node
// Tear down the live stack. Pass --volumes (or -v) to also drop the Postgres
// data volume and the per-project .tmp state. See harness.mjs.
import { down } from "./harness.mjs";

const removeVolumes = process.argv.slice(2).some((a) => a === "--volumes" || a === "-v");

try {
  await down({ removeVolumes });
  console.log("[live] down complete.");
} catch (error) {
  console.error(`✖ live:down failed: ${error.message}`);
  process.exit(1);
}
