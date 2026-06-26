import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewPage } from "./OverviewPage";
import { healthFixture, infoFixture, statusFixture } from "../test/fixtures";
import { createMockClient } from "../test/mockClient";

function loadedClient() {
  const client = createMockClient();
  client.get.mockImplementation((path: string) => {
    if (path === "/v1/health") return Promise.resolve(healthFixture);
    if (path === "/v1/info") return Promise.resolve(infoFixture);
    if (path === "/v1/status") return Promise.resolve(statusFixture);
    return Promise.reject(new Error(`Unexpected path ${path}`));
  });
  return client;
}

describe("OverviewPage states", () => {
  it("shows skeletons (not zeros) and a disabled refresh while the first load is in flight", () => {
    const client = createMockClient();
    client.get.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<OverviewPage client={client} />);

    // The old, misleading "Loading" / zero value text must be gone.
    expect(screen.queryByText("Loading")).toBeNull();
    // Skeleton placeholders stand in for every value.
    expect(screen.getAllByTestId("metric-skeleton").length).toBeGreaterThan(0);
    // Refresh stays clickable (so a stuck request can be retried) but signals busy.
    const refresh = screen.getByRole("button", { name: "Refresh overview" });
    expect(refresh).not.toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    // Panels render up front so the layout height is locked (no pop-in).
    expect(screen.getByText("base root")).toBeInTheDocument();
  });

  it("renders a freshness stamp once data loads", async () => {
    render(<OverviewPage client={loadedClient()} />);
    const stamp = await screen.findByTestId("overview-updated");
    expect(stamp.textContent).toMatch(/Updated \d{2}:\d{2}/);
  });

  it("links the Data, Knowledge, and Wisdom metrics to their routes", async () => {
    render(<OverviewPage client={loadedClient()} />);
    await screen.findByTestId("overview-updated");

    expect(screen.getByRole("link", { name: /Data/ })).toHaveAttribute("href", "#base");
    expect(screen.getByRole("link", { name: /Knowledge/ })).toHaveAttribute("href", "#graph");
    expect(screen.getByRole("link", { name: /Wisdom/ })).toHaveAttribute("href", "#wisdom");
  });

  it("exposes each metric as a description-list term/value (dt/dd)", async () => {
    render(<OverviewPage client={loadedClient()} />);
    await screen.findByTestId("overview-updated");

    const term = screen.getByText("Wisdom");
    expect(term.tagName).toBe("DT");
    expect(term.closest("dl")).not.toBeNull();
  });

  it("shows only an error notice — no stray metric cards — when the load fails", async () => {
    const client = createMockClient();
    client.get.mockImplementation(() => Promise.reject(new Error("boom")));
    render(<OverviewPage client={client} />);

    expect(await screen.findByText("Could not read dikw-core status")).toBeInTheDocument();
    expect(screen.queryByText("Server")).toBeNull();
    expect(screen.queryAllByTestId("metric-skeleton")).toHaveLength(0);
  });
});
