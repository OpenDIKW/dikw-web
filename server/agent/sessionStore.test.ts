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
});
