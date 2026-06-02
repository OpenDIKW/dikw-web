import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TracePage } from "./TracePage";

describe("TracePage (mock data)", () => {
  it("renders the heading and the first session's conversation + trace", () => {
    render(<TracePage locale="en" />);

    expect(screen.getByRole("heading", { name: "Trace" })).toBeInTheDocument();

    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(within(conversation).getByText(/DIKW stacks data/)).toBeInTheDocument();

    const trace = screen.getByRole("region", { name: "Trace" });
    expect(within(trace).getByText("execute_tool retrieve_knowledge")).toBeInTheDocument();
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
    render(<TracePage locale="en" />);
    const trace = screen.getByRole("region", { name: "Trace" });

    expect(within(trace).queryByText("Span attributes")).not.toBeInTheDocument();

    await user.click(within(trace).getByRole("button", { name: /execute_tool retrieve_knowledge/ }));

    expect(within(trace).getByText("Span attributes")).toBeInTheDocument();
    expect(within(trace).getByText("gen_ai.tool.name")).toBeInTheDocument();
  });

  it("switches the conversation and trace when another session is picked", async () => {
    const user = userEvent.setup();
    render(<TracePage locale="en" />);

    await user.click(screen.getByRole("button", { name: /List the wisdom items/ }));

    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(within(conversation).getByText(/3 wisdom items/)).toBeInTheDocument();
    const trace = screen.getByRole("region", { name: "Trace" });
    expect(within(trace).getByText("execute_tool list_wisdom")).toBeInTheDocument();
  });
});
