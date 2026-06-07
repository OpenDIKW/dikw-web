// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSessionService, createEvent } from "@google/adk";
import type { Session } from "@google/adk";
import { AdkSessionStore } from "./adkSessionStore";

const APP_NAME = "dikw-web";
const USER_ID = "local";

function makeStore() {
  const sessionService = new DatabaseSessionService("sqlite://:memory:");
  const store = new AdkSessionStore({ sessionService, appName: APP_NAME, userId: USER_ID });
  return { sessionService, store };
}

async function appendRaw(
  sessionService: DatabaseSessionService,
  sessionId: string,
  event: ReturnType<typeof createEvent>,
): Promise<void> {
  const session = (await sessionService.getSession({
    appName: APP_NAME,
    userId: USER_ID,
    sessionId,
  })) as Session;
  await sessionService.appendEvent({ session, event });
}

// Appends the standard tool-using turn used by several tests and returns the session id.
async function appendToolTurn(
  sessionService: DatabaseSessionService,
  sessionId: string,
): Promise<void> {
  await appendRaw(
    sessionService,
    sessionId,
    createEvent({ author: "user", content: { role: "user", parts: [{ text: "What is DIKW?" }] } }),
  );
  await appendRaw(
    sessionService,
    sessionId,
    createEvent({
      author: "dikw_agent",
      content: {
        role: "model",
        parts: [{ functionCall: { id: "tc-1", name: "retrieve_knowledge", args: { q: "DIKW" } } }],
      },
    }),
  );
  await appendRaw(
    sessionService,
    sessionId,
    createEvent({
      author: "dikw_agent",
      content: {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "tc-1",
              name: "retrieve_knowledge",
              response: {
                page_refs: [
                  {
                    path: "knowledge/architecture.md",
                    title: "Arch",
                    layer: "knowledge",
                    score: 0.9,
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );
  await appendRaw(
    sessionService,
    sessionId,
    createEvent({
      author: "dikw_agent",
      content: { role: "model", parts: [{ text: "Layered answer." }] },
    }),
  );
}

describe("AdkSessionStore", () => {
  let sessionService: DatabaseSessionService;
  let store: AdkSessionStore;

  beforeEach(() => {
    ({ sessionService, store } = makeStore());
  });

  it("creates an empty session with the default title", async () => {
    const created = await store.createSession();
    expect(created.title).toBe("New chat");
    expect(created.messages).toEqual([]);

    const loaded = await store.getSession(created.id);
    expect(loaded.title).toBe("New chat");
    expect(loaded.messages).toEqual([]);
    expect(loaded.messageCount).toBe(0);
  });

  it("projects a tool-using turn into messages, tool events, and sources", async () => {
    const created = await store.createSession();
    await appendToolTurn(sessionService, created.id);
    await store.finalizeTurn(created.id);

    const session = await store.getSession(created.id);
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(session.messages[1].content).toBe("Layered answer.");
    expect(session.messageCount).toBe(2);
    expect(session.toolEvents[0]).toMatchObject({
      id: "tc-1",
      name: "retrieve_knowledge",
      status: "succeeded",
    });
    expect(session.toolEvents[0].output).toEqual({
      page_refs: [
        { path: "knowledge/architecture.md", title: "Arch", layer: "knowledge", score: 0.9 },
      ],
    });
    expect(session.sources[0].path).toBe("knowledge/architecture.md");
  });

  it("joins multi-round assistant text within one invocation with no separator", async () => {
    const created = await store.createSession();
    const invocationId = "inv-multi";

    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "user",
        invocationId,
        content: { role: "user", parts: [{ text: "Q?" }] },
      }),
    );
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        invocationId,
        content: { role: "model", parts: [{ text: "Let me check." }] },
      }),
    );
    // A tool round-trip in the middle makes this a multi-round turn.
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        invocationId,
        content: {
          role: "user",
          parts: [
            {
              functionResponse: { id: "tc-9", name: "retrieve_knowledge", response: { ok: true } },
            },
          ],
        },
      }),
    );
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        invocationId,
        content: { role: "model", parts: [{ text: "The answer is 4." }] },
      }),
    );

    await store.finalizeTurn(created.id);

    const session = await store.getSession(created.id);
    const assistantMessages = session.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    // No "\n" between the two agent text segments — matches the streamed bubble.
    expect(assistantMessages[0].content).toBe("Let me check.The answer is 4.");
  });

  it("marks a failed tool response as failed with its error", async () => {
    const created = await store.createSession();
    await appendRaw(
      sessionService,
      created.id,
      createEvent({ author: "user", content: { role: "user", parts: [{ text: "search" }] } }),
    );
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        content: {
          role: "model",
          parts: [{ functionCall: { id: "tc-2", name: "web_search", args: {} } }],
        },
      }),
    );
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        content: {
          role: "user",
          parts: [
            { functionResponse: { id: "tc-2", name: "web_search", response: { error: "boom" } } },
          ],
        },
      }),
    );

    const session = await store.getSession(created.id);
    const toolEvent = session.toolEvents.find((e) => e.id === "tc-2");
    expect(toolEvent).toMatchObject({ status: "failed", error: "boom" });
  });

  it("auto-sets the title from the first user message and persists it for listSessions", async () => {
    const created = await store.createSession();
    await appendToolTurn(sessionService, created.id);
    await store.finalizeTurn(created.id);

    const summaries = await store.listSessions();
    const summary = summaries.find((s) => s.id === created.id);
    expect(summary?.title).toBe("What is DIKW?");
    expect(summary?.messageCount).toBe(2);
  });

  it("projects a maintenance proposal and overrides its status/taskId from state", async () => {
    const created = await store.createSession();
    await appendRaw(
      sessionService,
      created.id,
      createEvent({
        author: "dikw_agent",
        content: {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "pr-1",
                name: "propose_maintenance_action",
                response: { proposal: { action: "ingest", description: "d", params: {} } },
              },
            },
          ],
        },
      }),
    );

    const initial = await store.getSession(created.id);
    expect(initial.proposals[0]).toMatchObject({ id: "pr-1", status: "pending" });

    await store.updateProposalStatus(created.id, "pr-1", "confirmed");
    await store.recordProposal(created.id, {
      id: "pr-1",
      action: "ingest",
      title: "Run ingest",
      description: "d",
      status: "confirmed",
      params: {},
      taskId: "task-42",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const reprojected = await store.getSession(created.id);
    expect(reprojected.proposals[0]).toMatchObject({
      id: "pr-1",
      status: "confirmed",
      taskId: "task-42",
    });
  });

  it("never renders a context-compaction summary event as a chat message", async () => {
    const created = await store.createSession();
    await appendToolTurn(sessionService, created.id);
    // A persisted CompactedEvent (author "system", model-role text) is a
    // prompt-building artifact — it must not leak into the chat history.
    const base = createEvent({
      author: "system",
      content: { role: "model", parts: [{ text: "[Previous Context Summary] earlier turns" }] },
    });
    await appendRaw(sessionService, created.id, {
      ...base,
      isCompacted: true,
      startTime: 1,
      endTime: 2,
      compactedContent: "earlier turns",
    } as ReturnType<typeof createEvent>);
    await store.finalizeTurn(created.id);

    const session = await store.getSession(created.id);
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(session.messageCount).toBe(2);
    expect(session.messages.some((m) => m.content.includes("Previous Context Summary"))).toBe(
      false,
    );
  });

  it("produces a stable projection when reopened with a fresh store", async () => {
    const created = await store.createSession();
    await appendToolTurn(sessionService, created.id);
    await store.finalizeTurn(created.id);
    const first = await store.getSession(created.id);

    const reopened = new AdkSessionStore({ sessionService, appName: APP_NAME, userId: USER_ID });
    const second = await reopened.getSession(created.id);

    expect(second.messages).toEqual(first.messages);
    expect(second.toolEvents).toEqual(first.toolEvents);
    expect(second.sources).toEqual(first.sources);
    expect(second.proposals).toEqual(first.proposals);
  });
});
