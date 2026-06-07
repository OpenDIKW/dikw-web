// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadWebConfig } from "./config";

describe("web config", () => {
  it("reads the MinerU key from DIKW_WEB_MINERU_API_KEY in .env.local", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-web-config-"));
    try {
      await writeFile(join(cwd, ".env.local"), "DIKW_WEB_MINERU_API_KEY=mineru-secret\n", "utf8");

      const config = await loadWebConfig({ cwd, env: {} });

      expect(config.mineruApiKey).toBe("mineru-secret");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prefers an explicit env var over the .env.local file value", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-web-config-"));
    try {
      await writeFile(join(cwd, ".env.local"), "DIKW_WEB_MINERU_API_KEY=from-file\n", "utf8");

      const config = await loadWebConfig({ cwd, env: { DIKW_WEB_MINERU_API_KEY: "from-env" } });

      expect(config.mineruApiKey).toBe("from-env");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("trims surrounding whitespace from the configured key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-web-config-"));
    try {
      const config = await loadWebConfig({
        cwd,
        env: { DIKW_WEB_MINERU_API_KEY: "  spaced-secret  " },
      });

      expect(config.mineruApiKey).toBe("spaced-secret");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("leaves the key undefined when nothing is configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-web-config-"));
    try {
      const config = await loadWebConfig({ cwd, env: {} });

      expect(config.mineruApiKey).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not honor the retired MinerUAPIKey / DIKW_AGENT_MINERU_API_KEY names", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-web-config-"));
    try {
      // Hard rename: the old names are no longer a fallback.
      const config = await loadWebConfig({
        cwd,
        env: { MinerUAPIKey: "legacy-a", DIKW_AGENT_MINERU_API_KEY: "legacy-b" },
      });

      expect(config.mineruApiKey).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
