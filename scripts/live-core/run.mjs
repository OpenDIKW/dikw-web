#!/usr/bin/env node
// One-command live integration verification: up → seed → smoke → browser e2e →
// agent↔core observability check → down. Owns a dev server on a DYNAMIC port
// with the Vite proxy pointed at the live core. Flags:
//   --keep        leave the stack running at the end (skip down)
//   --skip-agent  skip the agent↔core observability check
// See docs/integration-verification.md.

import { spawn } from "node:child_process";
import { allocPort, up, down, dumpCoreLogs, loadState, run, REPO_ROOT } from "./harness.mjs";

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const SKIP_AGENT = args.includes("--skip-agent");

/** Spawn a long-running process in its own group so we can kill the whole tree. */
function spawnBg(cmd, cmdArgs, env) {
  return spawn(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, ...env },
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function waitHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status === 404) return; // server is answering
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server did not respond at ${url} within ${timeoutMs}ms`);
}

let devServer = null;

async function main() {
  const state = await up();

  // Write pipeline (import → ingest → synth → lint), then read contract.
  await run("npx", ["tsx", "scripts/seed-core.mts"]);
  await run("node", ["scripts/smoke-core.mjs"], {
    env: {
      ...process.env,
      DIKW_SMOKE_CORE_URL: state.coreUrl,
      DIKW_SMOKE_CORE_TOKEN: state.token,
    },
  });

  // Dev server (dynamic port) with the proxy aimed at the live core.
  const webPort = await allocPort();
  const webUrl = `http://127.0.0.1:${webPort}`;
  console.log(`[live] starting dev server at ${webUrl} (proxy → ${state.coreUrl})…`);
  devServer = spawnBg(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    { VITE_DIKW_PROXY_TARGET: state.coreUrl },
  );
  await waitHttp(`${webUrl}/`);

  // Browser read-route e2e.
  await run("npx", ["playwright", "test"], {
    env: {
      ...process.env,
      PLAYWRIGHT_LIVE: "1",
      PW_LIVE_BASE_URL: webUrl,
      PW_LIVE_TOKEN: state.token,
    },
  });

  // Agent↔core observability check (skips itself if the sidecar LLM key is unset).
  if (!SKIP_AGENT) {
    await run("node", ["scripts/live-core/verify-agent.mjs"], {
      env: { ...process.env, DIKW_LIVE_WEB_URL: webUrl },
    });
  }

  console.log("\n[live] ✓ live integration verification passed.");
}

main()
  .catch(async (error) => {
    console.error(`\n✖ live:verify failed: ${error.message}`);
    try {
      await dumpCoreLogs(loadState());
    } catch {
      /* no state */
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    killTree(devServer);
    if (!KEEP) {
      try {
        await down();
      } catch (e) {
        console.error(`[live] down failed: ${e.message}`);
      }
    } else {
      console.log("[live] --keep: stack left running (npm run live:down to stop).");
    }
  });
