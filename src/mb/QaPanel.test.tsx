import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QaPanel } from "./QaPanel";
import type { AgentClient } from "../api/agentClient";
import type { CurrentPaper } from "./MbApp";

function makeAgentClient(answer: string): AgentClient {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: "s1",
      title: "",
      messages: [],
      sources: [],
      toolEvents: [],
      createdAt: "",
      updatedAt: "",
    }),
    sendMessage: vi.fn(() =>
      (async function* () {
        yield { type: "message_delta", sessionId: "s1", delta: answer };
      })(),
    ),
  } as unknown as AgentClient;
}

const PAPER_A: CurrentPaper = { path: "sources/a.md", title: "Paper A" };
const PAPER_B: CurrentPaper = { path: "sources/b.md", title: "Paper B" };

async function ask(answer: string) {
  const input = await screen.findByPlaceholderText("问这篇论文…");
  fireEvent.change(input, { target: { value: "q" } });
  fireEvent.click(screen.getByLabelText("发送"));
  await screen.findByText(answer);
}

describe("QaPanel — per-paper history", () => {
  it("restores a paper's Q&A after switching to another paper and back", async () => {
    const agent = makeAgentClient("Answer for A.");
    const { rerender } = render(<QaPanel paper={PAPER_A} agentClient={agent} />);

    await ask("Answer for A.");

    // Switch to paper B — its conversation is empty (no leftovers from A).
    rerender(<QaPanel paper={PAPER_B} agentClient={agent} />);
    expect(screen.queryByText("Answer for A.")).not.toBeInTheDocument();

    // Back to paper A — the conversation is restored. Regression: the chat used
    // to be reset on every paper change, so returning to A wiped its history.
    rerender(<QaPanel paper={PAPER_A} agentClient={agent} />);
    expect(screen.getByText("Answer for A.")).toBeInTheDocument();
  });
});
