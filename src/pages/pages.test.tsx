import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OverviewPage } from "./OverviewPage";
import { QueryPage } from "./QueryPage";
import { RetrievePage } from "./RetrievePage";
import { TasksPage } from "./TasksPage";
import { WikiPage } from "./WikiPage";
import { WisdomPage } from "./WisdomPage";
import {
  createAsyncEvents,
  infoFixture,
  queryEventsFixture,
  readyFixture,
  retrieveEventsFixture,
  statusFixture,
  taskEventsFixture,
  taskRowsFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
  wisdomItemsFixture
} from "../test/fixtures";
import { createMockClient } from "../test/mockClient";

describe("read console pages", () => {
  it("loads overview status from the client", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/info") {
        return Promise.resolve(infoFixture);
      }
      if (path === "/v1/readyz") {
        return Promise.resolve(readyFixture);
      }
      if (path === "/v1/status") {
        return Promise.resolve(statusFixture);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<OverviewPage client={client} />);

    expect(await screen.findByText("dikw-core 0.0.1")).toBeInTheDocument();
    expect(screen.getByText("C:\\demo\\wiki")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "anthropic_compat · MiniMax-M2.7")).toBeInTheDocument();
  });

  it("loads wiki pages, renders markdown, and follows wikilinks", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/wiki/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/wiki/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/wiki/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Synthesis" }));
    expect(await screen.findByText("Synthesis Body.")).toBeInTheDocument();
  });

  it("loads wisdom items and refetches when filters change", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue(wisdomItemsFixture);

    render(<WisdomPage client={client} />);

    expect(await screen.findByText("Prefer evidence")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("状态"), "approved");

    await waitFor(() => {
      expect(client.get).toHaveBeenLastCalledWith(
        "/v1/wisdom",
        expect.objectContaining({
          params: expect.objectContaining({ status: "approved" })
        })
      );
    });
  });

  it("runs query streams into answer, hits, citations, and wisdom", async () => {
    const client = createMockClient();
    client.streamQuery.mockImplementation(() => createAsyncEvents(queryEventsFixture));

    render(<QueryPage client={client} />);
    await userEvent.type(screen.getByLabelText("Question"), "What is DIKW?");
    await userEvent.click(screen.getByRole("button", { name: /Run/ }));

    expect(await screen.findByText("Layered answer.")).toBeInTheDocument();
    expect(screen.getAllByText("wiki/architecture.md").length).toBeGreaterThan(0);
    expect(screen.getByText("W1 · principle · Prefer evidence")).toBeInTheDocument();
    expect(client.streamQuery).toHaveBeenCalledWith({ q: "What is DIKW?", limit: 5 }, expect.any(AbortSignal));
  });

  it("runs retrieve streams into chunks and page refs", async () => {
    const client = createMockClient();
    client.streamRetrieve.mockImplementation(() => createAsyncEvents(retrieveEventsFixture));

    render(<RetrievePage client={client} />);
    await userEvent.type(screen.getByLabelText("Query"), "DIKW");
    await userEvent.click(screen.getByRole("button", { name: /Run/ }));

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    expect(client.streamRetrieve).toHaveBeenCalledWith({ q: "DIKW", limit: 10 }, expect.any(AbortSignal));
  });

  it("summarizes eval tasks and loads event timelines without expanding raw JSON", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue(taskRowsFixture);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(taskEventsFixture));

    render(<TasksPage client={client} />);

    const detail = await screen.findByRole("heading", { name: "eval" });
    expect(detail).toBeInTheDocument();
    expect(screen.getByText("synthetic-diverse-v1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Load events/ }));

    expect(await screen.findByText("4 events")).toBeInTheDocument();
    expect(screen.getAllByText("Eval result").length).toBeGreaterThan(0);
    const finalDetails = screen.getByText("Raw final event").closest("details");
    expect(finalDetails).not.toHaveAttribute("open");
    expect(within(screen.getByText("Event tape").closest("section") as HTMLElement).getByText("#4")).toBeInTheDocument();
  });
});
