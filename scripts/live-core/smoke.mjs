#!/usr/bin/env node
// Run the /v1 read-contract smoke (scripts/smoke-core.mjs) against the live
// stack, resolving the dynamic core URL + token from the saved stack state so
// `npm run live:up && npm run live:smoke` works without manually exporting
// DIKW_SMOKE_CORE_URL / _TOKEN. An explicit env value still wins. See
// docs/integration-verification.md.
import { loadState } from "./harness.mjs";

const state = loadState();
process.env.DIKW_SMOKE_CORE_URL ??= state.coreUrl;
process.env.DIKW_SMOKE_CORE_TOKEN ??= state.token;

// smoke-core.mjs reads the env at module load and runs on import.
await import("../smoke-core.mjs");
