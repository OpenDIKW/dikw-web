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
        const turnId = "turn-1";
        runInputs.push({ coreUrl, token });
        await store.appendUserMessage(sessionId, message, turnId);
        const toolEvent = {
          id: "tool-1",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z"
        };
        await store.recordToolEvent(sessionId, toolEvent, turnId);
        await onEvent({ type: "tool_event", sessionId, event: { ...toolEvent, turnId } as typeof toolEvent });
        await onEvent({ type: "message_delta", sessionId, delta: "Layered answer." });
        await store.recordSource(sessionId, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" }, turnId);
        await onEvent({
          type: "source",
          sessionId,
          source: { path: "wiki/architecture.md", title: "Architecture", layer: "wiki", turnId } as {
            path: string;
            title: string;
            layer: string;
          }
        });
        await store.appendAssistantMessage(sessionId, "Layered answer.", turnId);
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
      .map((line) => JSON.parse(line) as { type: string; event?: { turnId?: string }; source?: { turnId?: string } });

    expect(events.map((event) => event.type)).toEqual(["tool_event", "message_delta", "source", "agent_end"]);
    expect(events.find((event) => event.type === "tool_event")?.event?.turnId).toBe("turn-1");
    expect(events.find((event) => event.type === "source")?.source?.turnId).toBe("turn-1");
    expect(runInputs).toEqual([{ coreUrl: "http://127.0.0.1:8765", token: "core-token" }]);

    const reopened = (await (await fetch(`${baseUrl}/sessions/${created.id}`)).json()) as {
      messages: Array<{ role: string; content: string; turnId?: string }>;
      sources: Array<{ path: string; turnId?: string }>;
      toolEvents: Array<{ id: string; turnId?: string }>;
    };
    expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(reopened.messages.map((message) => message.turnId)).toEqual(["turn-1", "turn-1"]);
    expect(reopened.toolEvents[0]).toMatchObject({ id: "tool-1", turnId: "turn-1" });
    expect(reopened.sources[0].path).toBe("wiki/architecture.md");
    expect(reopened.sources[0].turnId).toBe("turn-1");

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

  it("renames sessions through PATCH and rejects invalid titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-http-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const store = new FileSessionStore(root);
    const runner: AgentRunner = {
      async runMessage() {
        throw new Error("runner should not be called when renaming");
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
    const renamedResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Project Review" })
    });
    const renamed = (await renamedResponse.json()) as { title: string };

    expect(renamedResponse.status).toBe(200);
    expect(renamed.title).toBe("Project Review");
    await expect((await fetch(`${baseUrl}/sessions`)).json()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: "Project Review" })
    ]);

    const invalidResponse = await fetch(`${baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " })
    });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "session title is required" }
    });
  });
});
