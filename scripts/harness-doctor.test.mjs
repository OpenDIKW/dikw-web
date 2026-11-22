// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const source = fileURLToPath(new URL("../", import.meta.url));
let temp;
let repo;
function run(args = [], cwd = repo) {
  return spawnSync(process.execPath, [join(repo, "scripts/harness-doctor"), ...args], {
    cwd,
    encoding: "utf8",
    input: "{}",
  });
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "dikw-doctor-"));
  repo = join(temp, "work tree");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  for (const name of ["scripts/harness-doctor", "harness", "AGENTS.md"]) {
    cpSync(join(source, name), join(repo, name), { recursive: true });
  }
  expect(run(["sync"]).status).toBe(0);
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

it("reports a clean tree to each client from a nested working directory", () => {
  writeFileSync(join(temp, "CLAUDE.md"), "Parent instructions");
  expect(run().status).toBe(0);
  for (const client of ["claude", "codex", "antigravity"]) {
    const result = run(["session-start", client], join(repo, "scripts"));
    const body = JSON.parse(result.stdout);
    const receipt =
      client === "antigravity"
        ? body.injectSteps[0].systemMessage.systemMessage
        : body.hookSpecificOutput.additionalContext;
    expect(receipt).toContain("harness-doctor: OK");
    if (client === "claude") expect(receipt).toMatch(/AGENTS\.md.*read it/);
  }
});

it("diagnoses changed adapters and repairs them idempotently", () => {
  const paths = [
    ".agents/skills/dikw-web-watch-ci/SKILL.md",
    ".codex/agents/fixer.toml",
    ".agents/hooks.json",
  ];
  const originals = paths.map((p) => readFileSync(join(repo, p), "utf8"));
  for (const path of paths.slice(0, 2)) writeFileSync(join(repo, path), "drift\n");
  rmSync(join(repo, ".agents/hooks.json"));
  const result = run(["check"]);
  expect(result.status).toBe(1);
  for (const path of paths) expect(result.stdout).toContain(path);
  expect(result.stdout).toContain("missing .agents/hooks.json");
  expect(result.stdout).toContain("line 1, byte 0: expected");
  expect(run(["session-start", "codex"]).stdout).toContain("harness-doctor: FAIL");
  expect(run(["sync"]).status).toBe(0);
  expect(run(["sync"]).status).toBe(0);
  expect(paths.map((p) => readFileSync(join(repo, p), "utf8"))).toEqual(originals);
  expect(run().status).toBe(0);
});

it("detects a deleted skill attachment and restores its bytes", () => {
  const skill = "skills/dikw-web-watch-ci";
  const relative = "fixtures/check result.bin";
  const bytes = Buffer.from([0, 13, 10, 255]);
  mkdirSync(join(repo, "harness", skill, "fixtures"));
  writeFileSync(join(repo, "harness", skill, relative), bytes);
  expect(run(["sync"]).status).toBe(0);
  const target = join(repo, ".agents", skill, relative);
  rmSync(target);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(".agents/" + skill + "/" + relative);
  expect(run(["sync"]).status).toBe(0);
  expect(readFileSync(target)).toEqual(bytes);
});

it("preserves unregistered material and enforces the 200-line limit", () => {
  const extra = join(repo, ".claude/rules/incubating.md");
  writeFileSync(extra, "keep my work\n");
  expect(run().stdout).toContain("unexpected");
  run(["sync"]);
  expect(readFileSync(extra, "utf8")).toBe("keep my work\n");
  rmSync(extra);
  const local = join(repo, "CLAUDE.local.md");
  writeFileSync(local, "Personal instructions\n");
  expect(run().stdout).toContain("competing project instructions: CLAUDE.local.md");
  rmSync(local);
  const guide = join(repo, "AGENTS.md");
  const lines = readFileSync(guide, "utf8").trimEnd().split(/\r?\n/);
  while (lines.length < 200) lines.push("line");
  writeFileSync(guide, lines.join("\n") + "\n");
  expect(run().status).toBe(0);
  writeFileSync(guide, lines.join("\n") + "\nline 201\n");
  expect(run().status).toBe(1);
});

it("routes the verification gate and its generated fixer to the gate contract", () => {
  for (const path of ["scripts/harness-doctor", ".codex/agents/fixer.toml"]) {
    expect(run(["rules", path]).stdout.trim()).toBe(".codex/rules/areas/build-and-gates.md");
  }
});

it("preserves independent Claude settings and reports unregistered hooks", () => {
  const path = join(repo, ".claude/settings.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.permissions = { deny: ["Read(private.txt)"] };
  delete config.hooks.SessionStart;
  writeFileSync(path, "\uFEFF" + JSON.stringify(config));
  expect(run(["sync"]).status).toBe(0);
  const repaired = JSON.parse(readFileSync(path, "utf8"));
  expect(repaired.permissions).toEqual(config.permissions);
  expect(repaired.hooks.SessionStart).toHaveLength(1);
  repaired.hooks.Stop = [{ hooks: [{ type: "command", command: "echo local" }] }];
  writeFileSync(path, JSON.stringify(repaired));
  expect(run(["sync"]).status).toBe(1);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(repaired);
  for (const malformed of ['{"permissions":', "[]"]) {
    writeFileSync(path, malformed);
    const result = run(["sync"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(".claude/settings.json");
    expect(readFileSync(path, "utf8")).toBe(malformed);
  }
});

it("preserves executable skill helpers and detects changes to their mode", () => {
  const suffix = "skills/dikw-web-watch-ci/check.sh";
  const src = join(repo, "harness", suffix);
  const copies = [".claude", ".agents"].map((base) => join(repo, base, suffix));
  writeFileSync(src, "#!/bin/sh\nexit 0\n");
  if (process.platform === "win32") {
    execFileSync("git", ["add", "--chmod=+x", "--", src], { cwd: repo });
    expect(run(["sync"]).stdout).toContain("git add --chmod=+x");
    execFileSync("git", ["add", "--chmod=+x", "--", ...copies], { cwd: repo });
  } else {
    chmodSync(src, 0o755);
    expect(run(["sync"]).status).toBe(0);
    for (const path of copies) execFileSync(path, { cwd: repo });
  }
  expect(run().status).toBe(0);
  if (process.platform === "win32") {
    execFileSync("git", ["update-index", "--chmod=-x", "--", copies[0]], { cwd: repo });
  } else {
    chmodSync(copies[0], 0o644);
  }
  expect(run().stdout).toContain("executable mode .claude/");
  if (process.platform !== "win32") {
    expect(run(["sync"]).status).toBe(0);
    execFileSync(copies[0], { cwd: repo });
    expect(run().status).toBe(0);
  }
});

it("matches the shared path-routing fixtures from a nested working directory", () => {
  const fixture = JSON.parse(readFileSync(join(repo, "harness/tests/routing.json"), "utf8"));
  const path = join(repo, "harness/manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const [name, globs] of Object.entries(fixture.patterns)) {
    manifest.rules[name] = globs.map((glob) => "fixture/" + glob);
    writeFileSync(join(repo, "harness/rules", name + ".md"), name + "\n");
  }
  writeFileSync(path, JSON.stringify(manifest));
  expect(run(["sync"]).status).toBe(0);
  const selector = readFileSync(join(repo, ".agents/rules/config.md"), "utf8").split("\n")[2];
  expect(JSON.parse(selector.slice("globs: ".length))).toBe(
    "**/fixture/src/**/config.py,**/fixture/src/**/config.ts",
  );
  const nested = resolve(repo, "nested");
  mkdirSync(nested);
  for (const entry of fixture.cases) {
    const result = run(["rules", ...entry.paths.map((p) => "../fixture/" + p)], nested);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(
      entry.want.map((s) => ".codex/rules/areas/" + s + ".md").join("\n"),
    );
  }
});
