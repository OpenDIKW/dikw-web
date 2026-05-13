// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config";

describe("agent config", () => {
  it("loads MiniMax credentials from .env.agent.local without requiring VITE variables", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.agent.local"),
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
        join(cwd, ".env.agent.local"),
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

  it("does not read dikw-core URL from the sidecar credential file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "dikw-agent-config-"));
    try {
      await writeFile(
        join(cwd, ".env.agent.local"),
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
