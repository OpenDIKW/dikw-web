// @vitest-environment node
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHandler } from "./http";
import { FileSessionStore } from "./sessionStore";
import type { AgentRunner } from "./runtime";

describe("agent HTTP sidecar", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  it("creates sessions, streams message events, reopens history, and deletes sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-http-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root);
    const runInputs: Array<{ coreUrl?: string; token?: string }> = [];
    const runner: AgentRunner = {
      async runMessage({ sessionId, message, coreUrl, token, onEvent }) {
        runInputs.push({ coreUrl, token });
        await store.appendUserMessage(sessionId, message);
        await onEvent({ type: "message_delta", sessionId, delta: "Layered answer." });
        await store.recordSource(sessionId, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" });
        await onEvent({
          type: "source",
          sessionId,
          source: { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" }
        });
        await store.appendAssistantMessage(sessionId, "Layered answer.");
        await onEvent({ type: "agent_end", sessionId });
      }
    };
    const server = createServer(createAgentHandler({ store, runner }));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not bind to a TCP port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    const stream = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is DIKW?", coreUrl: "http://127.0.0.1:8765", token: "core-token" })
    });
    const events = (await stream.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });

    expect(events.map((event) => event.type)).toEqual(["message_delta", "source", "agent_end"]);
    expect(runInputs).toEqual([{ coreUrl: "http://127.0.0.1:8765", token: "core-token" }]);

    const reopened = (await (await fetch(`${baseUrl}/sessions/${created.id}`)).json()) as {
      messages: Array<{ role: string; content: string }>;
      sources: Array<{ path: string }>;
    };
    expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(reopened.sources[0].path).toBe("wiki/architecture.md");

    const summaries = (await (await fetch(`${baseUrl}/sessions`)).json()) as Array<{ id: string; messageCount: number }>;
    expect(summaries).toEqual([expect.objectContaining({ id: created.id, messageCount: 2 })]);

    await fetch(`${baseUrl}/sessions/${created.id}`, { method: "DELETE" });
    expect(await (await fetch(`${baseUrl}/sessions`)).json()).toEqual([]);
  });

  it("rejects agent messages that do not include a core URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-http-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root);
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called without coreUrl");
      }
    };
    const server = createServer(createAgentHandler({ store, runner }));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server did not bind to a TCP port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const created = (await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { id: string };
    const response = await fetch(`${baseUrl}/sessions/${created.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is DIKW?" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "coreUrl is required" }
    });
  });
});
