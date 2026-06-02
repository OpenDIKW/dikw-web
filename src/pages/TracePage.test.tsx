import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TracePage } from "./TracePage";
import { mockTraceSessions, mockTraceViews } from "./traceMockData";
import type { AgentClientLike } from "./agentTypes";
import type { AgentSession, SessionSummary } from "../agent/types";
import type { SessionTraceView } from "../agent/traceTypes";

// Fake client serving the existing mock fixtures over the live data-flow path
// (listSessions → getSession + getSessionTraces). The render tree is unchanged
// from the former mock-import version, so the assertions test the same UI.
function makeFakeClient(): AgentClientLike {
  const summaries: SessionSummary[] = mockTraceSessions.map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    lastMessagePreview: session.lastMessagePreview
  }));
  return {
    listSessions: async () => summaries,
    getSession: async (id: string): Promise<AgentSession> => {
      const session = mockTraceSessions.find((item) => item.id === id);
      if (!session) {
        throw new Error(`unknown session ${id}`);
      }
      return session;
    },
    getSessionTraces: async (id: string): Promise<SessionTraceView> =>
      mockTraceViews[id] ?? { sessionId: id, invocations: [] },
    createSession: async () => {
      throw new Error("not used");
    },
    renameSession: async () => {
      throw new Error("not used");
    },
    deleteSession: async () => {
      throw new Error("not used");
    },
    abort: async () => {
      throw new Error("not used");
    },
    sendMessage: async function* () {
      throw new Error("not used");
    }
  };
}

describe("TracePage (live data)", () => {
  it("renders the heading and the first session's conversation + trace", async () => {
    render(<TracePage agentClient={makeFakeClient()} locale="en" />);

    expect(screen.getByRole("heading", { name: "Trace" })).toBeInTheDocument();

    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(await within(conversation).findByText(/DIKW stacks data/)).toBeInTheDocument();

    const trace = screen.getByRole("region", { name: "Trace" });
    expect(await within(trace).findByText("execute_tool retrieve_knowledge")).toBeInTheDocument();
    // One waterfall row per span — call_llm appears twice in the first invocation.
    expect(within(trace).getAllByText("call_llm")).toHaveLength(2);
    // Token usage badge from the call_llm span.
    expect(within(trace).getByText(/1240/)).toBeInTheDocument();
    // Model name surfaced by default on each call_llm span.
    expect(within(trace).getAllByText("MiniMax-M3").length).toBeGreaterThanOrEqual(2);
    // Absolute timestamp on the invocation header.
    expect(within(trace).getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("reveals span attributes only after the span row is clicked", async () => {
    const user = userEvent.setup();
    render(<TracePage agentClient={makeFakeClient()} locale="en" />);
    const trace = screen.getByRole("region", { name: "Trace" });

    const toolButton = await within(trace).findByRole("button", { name: /execute_tool retrieve_knowledge/ });
    expect(within(trace).queryByText("Span attributes")).not.toBeInTheDocument();

    await user.click(toolButton);

    expect(within(trace).getByText("Span attributes")).toBeInTheDocument();
    expect(within(trace).getByText("gen_ai.tool.name")).toBeInTheDocument();
  });

  it("switches the conversation and trace when another session is picked", async () => {
    const user = userEvent.setup();
    render(<TracePage agentClient={makeFakeClient()} locale="en" />);

    await user.click(await screen.findByRole("button", { name: /List the wisdom items/ }));

    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(await within(conversation).findByText(/3 wisdom items/)).toBeInTheDocument();
    const trace = screen.getByRole("region", { name: "Trace" });
    expect(await within(trace).findByText("execute_tool list_wisdom")).toBeInTheDocument();
  });

  it("renders empty gracefully without an agent client", () => {
    render(<TracePage locale="en" />);
    expect(screen.getByRole("heading", { name: "Trace" })).toBeInTheDocument();
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});
