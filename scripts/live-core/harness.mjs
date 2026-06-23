// Shared library for the dikw-web live integration harness.
//
// Brings up a REAL dikw-core (GHCR image) + Postgres/pgvector on DYNAMIC ports
// under a unique compose project so multiple core versions coexist, then lets
// the current dikw-web working tree be verified against it. Thin command
// scripts (up/down/run) import these helpers; the seeder and verify-agent are
// separate entrypoints that read the persisted state. See
// docs/integration-verification.md.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");
export const DEFAULT_CORE_VERSION = process.env.DIKW_CORE_VERSION || "0.6.1";
// MiniMax model name for core's LLM leg. Defaults to the value dikw-web's own
// agent uses; override with DIKW_CORE_LLM_MODEL if core needs a different name.
export const LLM_MODEL = process.env.DIKW_CORE_LLM_MODEL || "MiniMax-M3";

const COMPOSE_FILE = join(REPO_ROOT, "docker-compose.live-core.yml");
const TEMPLATE_FILE = join(here, "dikw.template.yml");

/** Stable project identity. Override DIKW_LIVE_PROJECT to run a second stack
 *  (e.g. a different core version) in parallel without collision. */
export function project() {
  return process.env.DIKW_LIVE_PROJECT || "dikw-web-live";
}

function stackDir() {
  return join(REPO_ROOT, ".tmp", "live-core", project());
}

function stateFile() {
  return join(stackDir(), "state.json");
}

function envFile() {
  return join(stackDir(), "compose.env");
}

// ── small utilities ─────────────────────────────────────────────────────────

/** Grab a free TCP port from the OS (listen on :0, read the assignment). */
export function allocPort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

const hex = (bytes) => randomBytes(bytes).toString("hex");

/** Run a command, inheriting stdio by default. Rejects on non-zero exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: REPO_ROOT, ...opts });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveRun(0);
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

// ── .env.core ───────────────────────────────────────────────────────────────

/** Parse .env.core (KEY=VALUE) and assert the keys the fixture's dikw.yml
 *  names. Fail fast and actionably — this is the most common setup miss. */
export function loadEnvCore() {
  const path = join(REPO_ROOT, ".env.core");
  if (!existsSync(path)) {
    throw new Error(
      ".env.core not found at repo root. Copy .env.core.example to .env.core and fill in MINIMAX_API_KEY + GITEE_API_KEY (it is git-ignored).",
    );
  }
  const env = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  for (const key of ["MINIMAX_API_KEY", "GITEE_API_KEY"]) {
    if (!env[key]) {
      throw new Error(`.env.core is missing ${key} (required: MiniMax LLM + Gitee embeddings).`);
    }
  }
  return env;
}

// ── state ───────────────────────────────────────────────────────────────────

export function saveState(state) {
  mkdirSync(stackDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

/** Load the persisted stack state, or throw if `up` hasn't run for this
 *  project yet. */
export function loadState() {
  const path = stateFile();
  if (!existsSync(path)) {
    throw new Error(
      `No live stack state for project "${project()}". Run \`npm run live:up\` first (or use \`npm run live:verify\`).`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// ── compose ─────────────────────────────────────────────────────────────────

function composeArgs(state, extra) {
  return [
    "compose",
    "-p",
    state.project,
    "-f",
    COMPOSE_FILE,
    "--env-file",
    state.envFile,
    ...extra,
  ];
}

export function dockerCompose(state, extra, opts = {}) {
  return run("docker", composeArgs(state, extra), opts);
}

// ── bootstrap (dikw init + dikw.yml) ─────────────────────────────────────────

/** Idempotently prepare the base: `dikw init` once (if no dikw.yml), then write
 *  the Postgres + MiniMax/Gitee dikw.yml from the template. */
async function bootstrap(state) {
  mkdirSync(state.baseDir, { recursive: true });
  // The core image runs as UID 1000; make the bind mount writable for it.
  chmodSync(state.baseDir, 0o777);

  const dikwYml = join(state.baseDir, "dikw.yml");
  if (!existsSync(dikwYml)) {
    console.log("[live] dikw init (one-shot container)…");
    await run("docker", [
      "run",
      "--rm",
      "-e",
      "MSYS_NO_PATHCONV=1", // Git Bash path-translation guard (no-op elsewhere)
      "-v",
      `${state.baseDir}:/base`,
      state.image,
      "init",
      "/base",
    ]);
  }

  const dsn = `host=postgres port=5432 user=dikw password=${state.postgresPassword} dbname=dikw`;
  const yml = readFileSync(TEMPLATE_FILE, "utf8")
    .replaceAll("__LLM_MODEL__", LLM_MODEL)
    .replaceAll("__PG_DSN__", dsn);
  writeFileSync(dikwYml, yml);
  console.log(`[live] wrote ${dikwYml} (storage=postgres, llm=${LLM_MODEL})`);
}

// ── health ──────────────────────────────────────────────────────────────────

async function waitCoreHealthy(coreUrl, token, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${coreUrl}/v1/healthz`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`dikw-core did not become healthy within ${timeoutMs}ms (last: ${lastErr})`);
}

// ── up / down ───────────────────────────────────────────────────────────────

/** Allocate ports + secrets, bootstrap the base, start the stack, wait healthy.
 *  Returns the persisted state. Reuses existing state when re-run for the same
 *  project so `up` is idempotent. */
export async function up() {
  const envCore = loadEnvCore();
  const proj = project();
  const dir = stackDir();
  mkdirSync(dir, { recursive: true });

  // Reuse the prior port/token if state exists, so a re-`up` keeps a stable URL.
  let prior = {};
  if (existsSync(stateFile())) {
    try {
      prior = JSON.parse(readFileSync(stateFile(), "utf8"));
    } catch {
      prior = {};
    }
  }

  const coreHostPort = prior.coreHostPort || (await allocPort());
  const token = prior.token || hex(24);
  const postgresPassword = prior.postgresPassword || hex(18);
  const version = DEFAULT_CORE_VERSION;
  const image = `ghcr.io/opendikw/dikw-core:${version}`;
  const baseDir = join(dir, "base");

  const state = {
    project: proj,
    version,
    image,
    coreHostPort,
    coreUrl: `http://127.0.0.1:${coreHostPort}`,
    token,
    postgresPassword,
    baseDir,
    envFile: envFile(),
    llmModel: LLM_MODEL,
  };

  // Write the compose env file (also exposes the .env.core provider keys).
  const lines = [
    `DIKW_CORE_VERSION=${version}`,
    `DIKW_CORE_HOST_PORT=${coreHostPort}`,
    `DIKW_SERVER_TOKEN=${token}`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `DIKW_LIVE_BASE_DIR=${baseDir}`,
    `MINIMAX_API_KEY=${envCore.MINIMAX_API_KEY}`,
    `GITEE_API_KEY=${envCore.GITEE_API_KEY}`,
    `DEEPSEEK_API_KEY=${envCore.DEEPSEEK_API_KEY || ""}`,
    `DIKW_LOG_LEVEL=${process.env.DIKW_LOG_LEVEL || "INFO"}`,
  ];
  writeFileSync(state.envFile, lines.join("\n") + "\n");
  saveState(state);

  await bootstrap(state);

  console.log(`[live] docker compose up (project=${proj}, core :${coreHostPort})…`);
  await dockerCompose(state, ["up", "-d"]);

  console.log("[live] waiting for dikw-core /v1/healthz…");
  await waitCoreHealthy(state.coreUrl, state.token);
  console.log(`[live] dikw-core ${version} healthy at ${state.coreUrl}`);
  return state;
}

/** Tear the stack down. `removeVolumes` also drops the Postgres data + state. */
export async function down({ removeVolumes = false } = {}) {
  if (!existsSync(stateFile())) {
    console.log(`[live] no state for project "${project()}" — nothing to tear down.`);
    return;
  }
  const state = loadState();
  const extra = ["down"];
  if (removeVolumes) extra.push("--volumes");
  await dockerCompose(state, extra);
  if (removeVolumes) {
    rmSync(stackDir(), { recursive: true, force: true });
    console.log(`[live] removed ${stackDir()}`);
  }
}

/** Dump recent core logs (best-effort) — used when a step fails. */
export async function dumpCoreLogs(state) {
  try {
    await dockerCompose(state, ["logs", "--no-color", "--tail", "120", "dikw-core"]);
  } catch {
    /* best-effort */
  }
}
