#!/usr/bin/env node
// Bring up the live dikw-core + Postgres stack on dynamic ports. Prints the
// resolved core URL + token-posture for follow-on steps. See harness.mjs.
import { up } from "./harness.mjs";

try {
  const state = await up();
  console.log(`\nlive core ready:`);
  console.log(`  DIKW_SMOKE_CORE_URL=${state.coreUrl}`);
  console.log(`  token: configured (${state.token.length} chars, not printed)`);
  console.log(`  next: npm run live:seed && npm run live:smoke  (or: npm run live:verify)`);
} catch (error) {
  console.error(`✖ live:up failed: ${error.message}`);
  process.exit(1);
}
