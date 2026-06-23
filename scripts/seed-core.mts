#!/usr/bin/env node
// Drive the dikw-web WRITE pipeline against a live dikw-core: bundle the
// fixture exactly as the browser does (reusing buildImportBundle + DikwClient,
// so the wire shape can't drift from the app) and run
// import → ingest → synth → lint propose → lint apply, polling each task to a
// terminal state. Non-`succeeded` ⇒ non-zero exit. This is the write-path
// integration assertion the mocked e2e suite cannot give.
//
// Run via tsx (it imports TypeScript from src/). Reads the live stack state
// written by `npm run live:up`. Override the target with DIKW_SMOKE_CORE_URL /
// DIKW_SMOKE_CORE_TOKEN to seed an arbitrary core. See
// docs/integration-verification.md.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadState, REPO_ROOT } from "./live-core/harness.mjs";
import { buildImportBundle } from "../src/utils/import-bundle.ts";
import { DikwClient } from "../src/api/client.ts";
import type { TaskHandle } from "../src/types.ts";

const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "live-base", "sources");

function resolveTarget(): { coreUrl: string; token: string } {
  const envUrl = process.env.DIKW_SMOKE_CORE_URL;
  if (envUrl) {
    return { coreUrl: envUrl.replace(/\/+$/, ""), token: process.env.DIKW_SMOKE_CORE_TOKEN || "" };
  }
  const state = loadState();
  return { coreUrl: state.coreUrl, token: state.token };
}

/** Read the flat fixture dir into File[] (the input buildImportBundle expects).
 *  Bare filenames → computeProjectRelPath uses File.name → archived under
 *  sources/. */
function loadFixtureFiles(): File[] {
  const files: File[] = [];
  for (const name of readdirSync(FIXTURE_DIR).sort()) {
    const bytes = readFileSync(join(FIXTURE_DIR, name));
    const type = name.endsWith(".md") ? "text/markdown" : "application/octet-stream";
    files.push(new File([bytes], name, { type }));
  }
  return files;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll(
  client: DikwClient,
  handle: TaskHandle,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await client.getTask(handle.task_id);
    if (row.status === "succeeded") {
      console.log(`  ✓ ${label} succeeded (${handle.task_id})`);
      return;
    }
    if (row.status === "failed" || row.status === "cancelled") {
      throw new Error(`${label} ${row.status} (${handle.task_id}): ${JSON.stringify(row.error)}`);
    }
    await sleep(2500);
  }
  throw new Error(`${label} (${handle.task_id}) did not finish within ${timeoutMs}ms`);
}

async function main() {
  const { coreUrl, token } = resolveTarget();
  console.log(`[seed] target ${coreUrl} (token ${token ? "configured" : "none"})`);
  const client = new DikwClient({ baseUrl: coreUrl, token });

  // 1) Import the fixture bundle (synchronous endpoint).
  const bundle = await buildImportBundle(loadFixtureFiles());
  console.log(`[seed] bundled ${bundle.filesCount} files (${bundle.totalBytes}B)`);
  const imported = await client.importBundle(bundle.payload, bundle.manifestJson);
  console.log(
    `  ✓ import ${imported.import_id}: committed=${imported.committed.length} rejected=${imported.rejected.length}`,
  );
  if (imported.rejected.length) {
    console.log(`    rejected: ${JSON.stringify(imported.rejected)}`);
  }

  // 2) Ingest → 3) Synth → 4) Lint propose → 5) Lint apply (all async tasks).
  console.log("[seed] ingest…");
  await poll(client, await client.startIngest(), "ingest", 5 * 60_000);

  console.log("[seed] synth (LLM)…");
  await poll(client, await client.startSynth(), "synth", 15 * 60_000);

  console.log("[seed] lint propose…");
  const propose = await client.startLintPropose({ enableLlm: false });
  await poll(client, propose, "lint propose", 5 * 60_000);

  console.log("[seed] lint apply…");
  const apply = await client.startLintApply({ proposalTaskId: propose.task_id });
  await poll(client, apply, "lint apply", 5 * 60_000);

  console.log("\n[seed] write pipeline complete — import → ingest → synth → lint all succeeded.");
}

main().catch((error) => {
  console.error(`✖ seed-core failed: ${error.message}`);
  process.exit(1);
});
