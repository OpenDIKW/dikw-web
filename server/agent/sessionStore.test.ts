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

  it("persists messages, tool events, and sources as session context", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      await store.appendUserMessage(session.id, "What is DIKW?");
      await store.recordToolEvent(session.id, {
        id: "tool-1",
        type: "tool_call",
        name: "retrieve_knowledge",
        status: "succeeded",
        createdAt: "2026-05-13T00:00:00.000Z"
      });
      await store.recordSource(session.id, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" });
      await store.recordSource(session.id, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" });
      await store.appendAssistantMessage(session.id, "Layered answer.");

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(reopened.toolEvents[0]).toMatchObject({ id: "tool-1", status: "succeeded" });
      expect(reopened.sources).toEqual([expect.objectContaining({ path: "wiki/architecture.md" })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a core source and a web source even when path and title collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      await store.recordSource(session.id, { path: "wiki/architecture.md", title: "Architecture", layer: "wiki" });
      await store.recordSource(session.id, {
        path: "wiki/architecture.md",
        title: "Architecture",
        excerpt: "from web",
        kind: "web"
      });

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.sources).toEqual([
        expect.objectContaining({ path: "wiki/architecture.md", layer: "wiki" }),
        expect.objectContaining({ path: "wiki/architecture.md", kind: "web", excerpt: "from web" })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records web sources and de-duplicates them by path and title", async () => {
    const root = await mkdtemp(join(tmpdir(), "dikw-agent-sessions-"));
    try {
      const store = new FileSessionStore(root);
      const session = await store.createSession();

      await store.recordSource(session.id, {
        path: "https://example.com/a",
        title: "Example A",
        excerpt: "first",
        kind: "web"
      });
      await store.recordSource(session.id, {
        path: "https://example.com/a",
        title: "Example A",
        excerpt: "duplicate ignored",
        kind: "web"
      });
      await store.recordSource(session.id, {
        path: "https://example.com/b",
        title: "Example B",
        kind: "web"
      });
      await store.recordSource(session.id, {
        path: "wiki/architecture.md",
        title: "Architecture",
        layer: "wiki"
      });

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.sources).toEqual([
        expect.objectContaining({ path: "https://example.com/a", kind: "web", excerpt: "first" }),
        expect.objectContaining({ path: "https://example.com/b", kind: "web" }),
        expect.objectContaining({ path: "wiki/architecture.md", layer: "wiki" })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates tool events with the same id in place", async () => {
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

      await store.recordToolEvent(session.id, baseTool);
      await store.recordToolEvent(session.id, { ...baseTool, status: "succeeded" });

      const reopened = await new FileSessionStore(root).getSession(session.id);
      expect(reopened.toolEvents).toEqual([expect.objectContaining({ id: "tool-1", status: "succeeded" })]);
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
