// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const source = fileURLToPath(new URL("../", import.meta.url));
const gitRepositoryVariables = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
]);
function createWorktree(temp) {
  const repo = join(temp, "work tree");
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !gitRepositoryVariables.has(name.toUpperCase())),
  );
  function exec(command, args = []) {
    return execFileSync(command, args, { cwd: repo, env: childEnv });
  }
  function run(args = [], cwd = repo) {
    return spawnSync(process.execPath, [join(repo, "scripts/harness-doctor"), ...args], {
      cwd,
      env: childEnv,
      encoding: "utf8",
      input: "{}",
    });
  }
  mkdirSync(join(repo, "scripts"), { recursive: true });
  exec("git", ["init", "-q"]);
  for (const name of ["scripts/harness-doctor", "harness", "AGENTS.md"]) {
    cpSync(join(source, name), join(repo, name), { recursive: true });
  }
  expect(run(["sync"]).status).toBe(0);
  return { repo, run, exec };
}

it("isolates the fixture's Git operations from the invoking hook", () => {
  const temp = mkdtempSync(join(tmpdir(), "dikw-doctor-hook-"));
  const outer = join(temp, "caller");
  try {
    mkdirSync(outer);
    for (const name of gitRepositoryVariables) vi.stubEnv(name, outer);
    const { run, exec } = createWorktree(temp);
    exec("git", ["add", "--", "AGENTS.md"]);
    expect(exec("git", ["ls-files", "--", "AGENTS.md"]).toString().trim()).toBe("AGENTS.md");
    expect(run().status).toBe(0);
    expect(readdirSync(outer)).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    rmSync(temp, { recursive: true, force: true });
  }
});

describe("in a fresh worktree", () => {
  let temp;
  let repo;
  let run;
  let exec;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "dikw-doctor-"));
    ({ repo, run, exec } = createWorktree(temp));
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

  describe("changed and missing adapters", () => {
    const paths = [
      ".agents/skills/dikw-web-watch-ci/SKILL.md",
      ".codex/agents/fixer.toml",
      ".agents/hooks.json",
    ];
    let originals;
    const contents = () => paths.map((p) => readFileSync(join(repo, p), "utf8"));
    beforeEach(() => {
      originals = contents();
      for (const path of paths.slice(0, 2)) writeFileSync(join(repo, path), "drift\n");
      rmSync(join(repo, ".agents/hooks.json"));
    });
    it("reports each difference through check and session-start", () => {
      const result = run(["check"]);
      expect(result.status).toBe(1);
      for (const path of paths) expect(result.stdout).toContain(path);
      expect(result.stdout).toContain("missing .agents/hooks.json");
      expect(result.stdout).toContain("line 1, byte 0: expected");
      expect(run(["session-start", "codex"]).stdout).toContain("harness-doctor: FAIL");
    });
    it("restores the original contents and stays clean after a second sync", () => {
      expect(run(["sync"]).status).toBe(0);
      expect(contents()).toEqual(originals);
      expect(run(["sync"]).status).toBe(0);
      expect(contents()).toEqual(originals);
      expect(run().status).toBe(0);
    });
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

  it("preserves unregistered material during sync", () => {
    const extra = join(repo, ".claude/rules/incubating.md");
    writeFileSync(extra, "keep my work\n");
    expect(run().stdout).toContain("unexpected");
    run(["sync"]);
    expect(readFileSync(extra, "utf8")).toBe("keep my work\n");
  });

  it("allows private Claude instructions and reports a tracked copy", () => {
    const local = join(repo, "CLAUDE.local.md");
    writeFileSync(local, "Personal instructions\n");
    expect(run().status).toBe(0);
    exec("git", ["add", "-f", "--", "CLAUDE.local.md"]);
    expect(run().stdout).toContain("competing project instructions: CLAUDE.local.md");
  });

  it("reports competing Antigravity project instructions", () => {
    const names = ["GEMINI.md", ".agents/AGENTS.md", "_agent/GEMINI.md"];
    for (const name of names) {
      const conflict = join(repo, name);
      mkdirSync(resolve(conflict, ".."), { recursive: true });
      writeFileSync(conflict, "other root");
    }
    const result = run();
    expect(result.status).toBe(1);
    for (const name of names) expect(result.stdout).toContain(name);
  });

  it("enforces the 200-line instruction budget", () => {
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

  it("routes protected HTTP handlers and live verification scripts", () => {
    for (const route of [
      "packages/web-server/src/web/http.ts",
      "packages/web-server/src/agent/http.ts",
    ]) {
      expect(run(["rules", route]).stdout).toContain(".codex/rules/areas/auth.md");
    }
    expect(run(["rules", "scripts/live-core/run.mjs"]).stdout).toContain(
      ".codex/rules/areas/testing.md",
    );
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

  it.each([".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json"])(
    "keeps unregistered and malformed hooks in %s",
    (name) => {
      const path = join(repo, name);
      const config = JSON.parse(readFileSync(path, "utf8"));
      const owner = name.startsWith(".agents/") ? config["harness-doctor"] : config.hooks;
      const replacement = structuredClone(owner.SessionStart);
      const [handler] = replacement[0].hooks ?? replacement;
      handler.command = "node scripts/session-bootstrap.mjs";
      delete handler.statusMessage;
      for (const changed of [
        [...owner.SessionStart, { type: "command", command: "echo local" }],
        { custom: true },
        replacement,
      ]) {
        owner.SessionStart = changed;
        const content = JSON.stringify(config);
        writeFileSync(path, content);
        const result = run(["sync"]);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(name);
        expect(readFileSync(path, "utf8")).toBe(content);
      }
    },
  );

  it("preserves executable skill helpers and detects changes to their mode", () => {
    const suffix = "skills/dikw-web-watch-ci/check.sh";
    const src = join(repo, "harness", suffix);
    const copies = [".claude", ".agents"].map((base) => join(repo, base, suffix));
    writeFileSync(src, "#!/bin/sh\nexit 0\n");
    if (process.platform === "win32") {
      exec("git", ["add", "--chmod=+x", "--", src]);
      expect(run(["sync"]).stdout).toContain("git add --chmod=+x");
      exec("git", ["add", "--chmod=+x", "--", ...copies]);
    } else {
      chmodSync(src, 0o755);
      expect(run(["sync"]).status).toBe(0);
      for (const path of copies) exec(path);
    }
    expect(run().status).toBe(0);
    if (process.platform === "win32") {
      exec("git", ["update-index", "--chmod=-x", "--", copies[0]]);
    } else {
      chmodSync(copies[0], 0o644);
    }
    expect(run().stdout).toContain("executable mode .claude/");
    if (process.platform !== "win32") {
      expect(run(["sync"]).status).toBe(0);
      exec(copies[0]);
      expect(run().status).toBe(0);
    }
  });
});

describe("shared path-routing fixtures", () => {
  const fixture = JSON.parse(readFileSync(join(source, "harness/tests/routing.json"), "utf8"));
  let temp;
  let repo;
  let run;
  let nested;
  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), "dikw-routing-"));
    ({ repo, run } = createWorktree(temp));
    const path = join(repo, "harness/manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    for (const [name, globs] of Object.entries(fixture.patterns)) {
      manifest.rules[name] = globs.map((glob) => "fixture/" + glob);
      writeFileSync(join(repo, "harness/rules", name + ".md"), name + "\n");
    }
    writeFileSync(path, JSON.stringify(manifest));
    expect(run(["sync"]).status).toBe(0);
    nested = join(repo, "nested");
    mkdirSync(nested);
  });
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  it("generates the Antigravity selector for both config extensions", () => {
    const selector = readFileSync(join(repo, ".agents/rules/config.md"), "utf8").split("\n")[2];
    expect(JSON.parse(selector.slice("globs: ".length))).toBe(
      "**/fixture/src/**/config.py,**/fixture/src/**/config.ts",
    );
  });
  it.each(fixture.cases)("routes $paths from a nested working directory", (entry) => {
    const result = run(["rules", ...entry.paths.map((p) => "../fixture/" + p)], nested);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(
      entry.want.map((s) => ".codex/rules/areas/" + s + ".md").join("\n"),
    );
  });
});
