// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseEnv, readEnvFile, readOptional } from "./env";

describe("parseEnv", () => {
  it("parses KEY=value pairs", () => {
    expect(parseEnv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("skips blank lines and # comments", () => {
    expect(parseEnv("\n# a comment\nA=1\n\n# B=ignored\nB=2\n")).toEqual({ A: "1", B: "2" });
  });

  it("strips matching surrounding double and single quotes", () => {
    expect(parseEnv("A=\"quoted\"\nB='single'")).toEqual({ A: "quoted", B: "single" });
  });

  it("leaves mismatched or unquoted values untouched", () => {
    expect(parseEnv("A=\"half\nB=plain")).toEqual({ A: "\"half", B: "plain" });
  });

  it("trims whitespace around key and value", () => {
    expect(parseEnv("  A  =  spaced  ")).toEqual({ A: "spaced" });
  });

  it("splits on the first = so values may contain =", () => {
    expect(parseEnv("URL=https://example/path?a=1&b=2")).toEqual({
      URL: "https://example/path?a=1&b=2"
    });
  });

  it("ignores lines without an = separator", () => {
    expect(parseEnv("A=1\nnonsense\nB=2")).toEqual({ A: "1", B: "2" });
  });

  it("handles CRLF line endings", () => {
    expect(parseEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("readEnvFile", () => {
  it("reads and parses an existing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dikw-env-"));
    try {
      await writeFile(join(dir, ".env.local"), "A=1\nB=2\n", "utf8");
      expect(await readEnvFile(join(dir, ".env.local"))).toEqual({ A: "1", B: "2" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty map when the file is missing (ENOENT)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dikw-env-"));
    try {
      expect(await readEnvFile(join(dir, "does-not-exist.local"))).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("propagates a non-ENOENT read error", async () => {
    // Reading a directory rejects (EISDIR / EPERM) — not ENOENT, so it must throw.
    const dir = await mkdtemp(join(tmpdir(), "dikw-env-"));
    try {
      await expect(readEnvFile(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readOptional", () => {
  it("returns the trimmed value", () => {
    expect(readOptional({ K: "  v  " }, "K")).toBe("v");
  });

  it("returns undefined when the key is unset", () => {
    expect(readOptional({}, "K")).toBeUndefined();
  });

  it("returns undefined when the value is blank or whitespace-only", () => {
    expect(readOptional({ K: "   " }, "K")).toBeUndefined();
    expect(readOptional({ K: "" }, "K")).toBeUndefined();
  });
});
