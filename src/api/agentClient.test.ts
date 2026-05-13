import { describe, expect, it, vi } from "vitest";
import { AgentClient } from "./agentClient";

describe("AgentClient", () => {
  it("lists sessions and sends the current core connection with agent messages", async () => {
    const messageBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === "/agent/sessions" && (!init?.method || init.method === "GET")) {
          return Promise.resolve(Response.json([{ id: "s1", title: "DIKW", messageCount: 0 }]));
        }
        if (url.pathname === "/agent/sessions/s1/messages") {
          messageBodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            new Response(
              [
                JSON.stringify({ type: "message_delta", sessionId: "s1", delta: "Hello" }),
                JSON.stringify({ type: "agent_end", sessionId: "s1" })
              ].join("\n"),
              { headers: { "Content-Type": "application/x-ndjson" } }
            )
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      })
    );

    const client = new AgentClient({ coreUrl: "http://127.0.0.1:8765", token: "secret-token" });
    await expect(client.listSessions()).resolves.toEqual([{ id: "s1", title: "DIKW", messageCount: 0 }]);

    const events = [];
    for await (const event of client.sendMessage("s1", "Hi")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "message_delta", sessionId: "s1", delta: "Hello" },
      { type: "agent_end", sessionId: "s1" }
    ]);
    expect(messageBodies).toEqual([{ message: "Hi", coreUrl: "http://127.0.0.1:8765", token: "secret-token" }]);
  });

  it("sends the current core connection when confirming maintenance proposals", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === "/agent/sessions/s1/proposals/p1/confirm") {
          bodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            Response.json({
              id: "s1",
              title: "DIKW",
              createdAt: "now",
              updatedAt: "now",
              messageCount: 0,
              lastMessagePreview: "",
              messages: [],
              toolEvents: [],
              sources: [],
              proposals: []
            })
          );
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      })
    );

    const client = new AgentClient({ coreUrl: "http://127.0.0.1:8765", token: "secret-token" });
    await client.confirmProposal("s1", "p1");

    expect(bodies).toEqual([{ coreUrl: "http://127.0.0.1:8765", token: "secret-token" }]);
  });
});
