// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileSessionStore } from "./sessionStore";

describe("FileSessionStore", () => {
  it("creates, persists, lists, reopens, and deletes agent sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      await store.appendUserMessage(session.id, "How does DIKW work?");
      await store.appendAssistantMessage(session.id, "DIKW layers data into wisdom.");
      await store.recordToolEvent(session.id, {
        id: "tool-1",
        type: "tool_call",
        name: "retrieve_knowledge",
        status: "succeeded",
        createdAt: "2026-05-13T00:00:00.000Z",
        input: { q: "DIKW" },
        output: { chunks: 2 }
      });

      const reopenedStore = new FileSessionStore(root);
      const summaries = await reopenedStore.listSessions();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: session.id,
        title: "How does DIKW work?",
        messageCount: 2,
        lastMessagePreview: "DIKW layers data into wisdom."
      });

      const reopened = await reopenedStore.getSession(session.id);
      expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(reopened.toolEvents).toHaveLength(1);
      expect(JSON.stringify(reopened)).not.toContain("secret");

      await reopenedStore.deleteSession(session.id);
      expect(await reopenedStore.listSessions()).toEqual([]);
      await expect(reopenedStore.getSession(session.id)).rejects.toThrow("not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists messages, tool events, and sources with their turn id", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      await store.appendUserMessage(session.id, "What is DIKW?", "turn-1");
      await store.recordToolEvent(
        session.id,
        {
          id: "tool-1",
          type: "tool_call",
          name: "retrieve_knowledge",
          status: "succeeded",
          createdAt: "2026-05-13T00:00:00.000Z"
        },
        "turn-1"
      );
      await store.recordSource(session.id, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" }, "turn-1");
      await store.appendAssistantMessage(session.id, "Layered answer.", "turn-1");

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.messages.map((message) => ({ role: message.role, turnId: message.turnId }))).toEqual([
        { role: "user", turnId: "turn-1" },
        { role: "assistant", turnId: "turn-1" }
      ]);
      expect(reopened.toolEvents[0]).toMatchObject({ id: "tool-1", turnId: "turn-1" });
      expect(reopened.sources[0]).toMatchObject({ path: "wiki/architecture.md", turnId: "turn-1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps tool events with the same id separate across turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();
      const baseTool = {
        id: "tool-1",
        type: "tool_call" as const,
        name: "retrieve_knowledge",
        status: "running" as const,
        createdAt: "2026-05-13T00:00:00.000Z"
      };

      await store.recordToolEvent(session.id, baseTool, "turn-1");
      await store.recordToolEvent(session.id, { ...baseTool, status: "succeeded" }, "turn-1");
      await store.recordToolEvent(session.id, { ...baseTool, status: "failed" }, "turn-2");

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.toolEvents).toEqual([
        expect.objectContaining({ id: "tool-1", status: "succeeded", turnId: "turn-1" }),
        expect.objectContaining({ id: "tool-1", status: "failed", turnId: "turn-2" })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames sessions, persists titles, and preserves manual titles after the first message", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      const renamed = await store.renameSession(session.id, "Project Review");
      expect(renamed.title).toBe("Project Review");
      expect(new Date(renamed.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(session.updatedAt).getTime());

      await store.appendUserMessage(session.id, "This first message should not replace the manual title");

      const reopenedStore = new FileSessionStore(root);
      const reopened = await reopenedStore.getSession(session.id);
      expect(reopened.title).toBe("Project Review");
      expect((await reopenedStore.listSessions())[0].title).toBe("Project Review");

      await expect(reopenedStore.renameSession(session.id, "   ")).rejects.toThrow("session title is required");
      await expect(reopenedStore.renameSession(session.id, "x".repeat(81))).rejects.toThrow("session title is too long");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
