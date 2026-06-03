// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { loadAgentConfig } from "./config";

describe("agent config", () => {
  it("loads MiniMax credentials from .env.local without requiring VITE variables", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_PROVIDER=minimax",
          "DIKW_AGENT_API=anthropic-messages",
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M2.7"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.provider).toBe("minimax");
      expect(config.api).toBe("anthropic-messages");
      expect(config.apiKey).toBe("secret-minimax-key");
      expect(config.baseUrl).toBe("https://api.minimaxi.com/anthropic");
      expect(config.model).toBe("MiniMax-M2.7");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports missing LLM keys without leaking configured values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_PROVIDER=minimax",
          "DIKW_AGENT_API=anthropic-messages",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M2.7"
        ].join("\n"),
        "utf8"
      );

      await expect(loadAgentConfig({ cwd, env: {} })).rejects.toThrow(
        "DIKW_AGENT_API_KEY is required"
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("treats web tool keys as optional and trims their values when present", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_PROVIDER=minimax",
          "DIKW_AGENT_API=anthropic-messages",
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M2.7",
          "DIKW_AGENT_BRAVE_API_KEY=  brave-secret  ",
          "DIKW_AGENT_JINA_API_KEY=jina-secret",
          "DIKW_AGENT_TAVILY_API_KEY=  tavily-secret  "
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.braveApiKey).toBe("brave-secret");
      expect(config.jinaApiKey).toBe("jina-secret");
      expect(config.tavilyApiKey).toBe("tavily-secret");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("leaves web tool keys undefined when not configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_PROVIDER=minimax",
          "DIKW_AGENT_API=anthropic-messages",
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M2.7"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.braveApiKey).toBeUndefined();
      expect(config.jinaApiKey).toBeUndefined();
      expect(config.tavilyApiKey).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("defaults compaction to enabled with the MiniMax-M3 window and a 0.5 ratio", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M3"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.compaction).toEqual({
        enabled: true,
        contextWindow: 1_048_576,
        ratio: 0.5,
        retention: 8
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("overrides compaction knobs from the environment", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M3",
          "DIKW_AGENT_COMPACTION_ENABLED=false",
          "DIKW_AGENT_CONTEXT_WINDOW=200000",
          "DIKW_AGENT_COMPACTION_RATIO=0.6",
          "DIKW_AGENT_COMPACTION_RETENTION=12"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.compaction).toEqual({
        enabled: false,
        contextWindow: 200000,
        ratio: 0.6,
        retention: 12
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to compaction defaults for blank or non-numeric overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M3",
          "DIKW_AGENT_CONTEXT_WINDOW=not-a-number",
          "DIKW_AGENT_COMPACTION_RATIO=-1",
          "DIKW_AGENT_COMPACTION_RETENTION="
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect(config.compaction).toEqual({
        enabled: true,
        contextWindow: 1_048_576,
        ratio: 0.5,
        retention: 8
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the compaction default and warns on an unrecognized enabled flag", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M3",
          "DIKW_AGENT_COMPACTION_ENABLED=disabled"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      // A typo'd disable must not silently leave compaction off-by-fallback semantics:
      // it stays at the default (true) AND surfaces a warning.
      expect(config.compaction.enabled).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not read dikw-core URL from the sidecar credential file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.local"),
        [
          "DIKW_AGENT_PROVIDER=minimax",
          "DIKW_AGENT_API=anthropic-messages",
          "DIKW_AGENT_API_KEY=secret-minimax-key",
          "DIKW_AGENT_BASE_URL=https://api.minimaxi.com/anthropic",
          "DIKW_AGENT_MODEL=MiniMax-M2.7",
          "DIKW_CORE_URL=http://127.0.0.1:9999"
        ].join("\n"),
        "utf8"
      );

      const config = await loadAgentConfig({ cwd, env: {} });

      expect("coreUrl" in config).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
