import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { createMockClient } from "../test/mockClient";
import type { AgentClient } from "../api/agentClient";

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

function mountWorkspace(answer: string) {
  const client = createMockClient();
  client.get.mockImplementation((path: string) => {
    if (path === "/v1/base/pages") {
      return Promise.resolve([
        {
          doc_id: "d1",
          path: "sources/p1.md",
          path_key: "sources/p1.md",
          title: "Paper One",
          hash: "",
          mtime: 0,
          layer: "source",
          active: true,
        },
      ]);
    }
    if (path.startsWith("/v1/base/pages/")) {
      return Promise.resolve({
        doc_id: "d1",
        path: "sources/p1.md",
        layer: "source",
        title: "Paper One",
        body: "# Paper One\n\nbody",
        anchors: [],
        assets: [],
      });
    }
    return Promise.resolve(undefined);
  });
  render(
    <ResearchWorkspace
      client={client}
      agentClient={makeAgentClient(answer)}
      assetBaseUrl=""
      assetToken=""
      translatorEnabled={false}
      translateCache={null}
      onCurrentPaperChange={() => {}}
    />,
  );
}

describe("ResearchWorkspace — Q&A panel collapse", () => {
  it("keeps the conversation when the right panel is collapsed and re-expanded", async () => {
    mountWorkspace("AI says hello.");

    // Select a paper so the Q&A panel is active.
    fireEvent.click(await screen.findByText("Paper One"));

    // Ask a question and wait for the streamed answer.
    const input = await screen.findByPlaceholderText("问这篇论文…");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText("发送"));
    await screen.findByText("AI says hello.");

    // Collapse the right panel. Regression: this used to UNMOUNT QaPanel and wipe
    // the chat history. With the fix the panel is only hidden, so the answer must
    // still be in the DOM.
    fireEvent.click(screen.getByRole("button", { name: "折叠知识问答" }));
    expect(screen.getByText("AI says hello.")).toBeInTheDocument();

    // Re-expand (the reader toggle is the first of the two "展开知识问答" controls,
    // the other being the edge button) — the conversation is back and visible.
    fireEvent.click(screen.getAllByRole("button", { name: "展开知识问答" })[0]);
    expect(screen.getByText("AI says hello.")).toBeVisible();
  });
});
