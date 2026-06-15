import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PaperLibrary } from "./PaperLibrary";
import { DikwClientError } from "../api/client";
import { createMockClient } from "../test/mockClient";

function renderLib(client: ReturnType<typeof createMockClient>) {
  render(
    <PaperLibrary
      client={client}
      selectedPath={null}
      onSelect={() => {}}
      onPickClick={() => {}}
      uploads={[]}
      onDismissUpload={() => {}}
      onRetryUpload={() => {}}
      reloadKey={0}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  // Always reset the hash — a failed assertion mid-test must not leak it.
  window.location.hash = "";
});

describe("PaperLibrary — actionable connection error", () => {
  it("tells the user auth failed (and offers settings) on a 401", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(
      new DikwClientError({ status: 401, code: "unauthorized", message: "no token" }),
    );
    renderLib(client);

    const msg = await screen.findByText(/鉴权失败|Token/);
    expect(msg).toBeInTheDocument();
    // The generic message must NOT be what's shown for an auth failure.
    expect(screen.queryByText("论文库加载失败，请确认 dikw-core 已连接。")).not.toBeInTheDocument();
  });

  it("tells the user the core is unreachable on a network error", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLib(client);

    expect(await screen.findByText(/无法连接|Server URL/)).toBeInTheDocument();
  });

  it("navigates to the workbench Settings page when the error's settings button is clicked", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(
      new DikwClientError({ status: 401, code: "unauthorized", message: "no token" }),
    );
    renderLib(client);

    fireEvent.click(await screen.findByRole("button", { name: "连接设置" }));
    expect(window.location.hash).toBe("#settings");
  });
});
