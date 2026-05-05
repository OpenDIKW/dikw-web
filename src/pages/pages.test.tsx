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
import type { TaskEvent, TaskRow } from "../types";

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

  it("refreshes the selected wiki page body from the header action", async () => {
    const client = createMockClient();
    let bodyReads = 0;
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/wiki/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/wiki/pages/")) {
        bodyReads += 1;
        const selectedPath = decodeURIComponent(path.replace("/v1/wiki/pages/", ""));
        return Promise.resolve({
          ...wikiPageBodiesFixture[selectedPath],
          body: bodyReads === 1 ? "Original Body." : "Updated Body."
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Original Body.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "刷新 Wiki 列表" }));

    expect(await screen.findByText("Updated Body.")).toBeInTheDocument();
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

  it("refreshes the open task event tape from the header action", async () => {
    const client = createMockClient();
    const refreshedEvents: TaskEvent[] = [
      ...taskEventsFixture.slice(0, -1),
      {
        type: "log",
        seq: 4,
        ts: "2026-05-05T09:37:26Z",
        level: "INFO",
        message: "events refreshed"
      },
      { ...taskEventsFixture[taskEventsFixture.length - 1], seq: 5 }
    ];
    client.get.mockResolvedValue(taskRowsFixture);
    client.streamTaskEvents
      .mockImplementationOnce(() => createAsyncEvents(taskEventsFixture))
      .mockImplementationOnce(() => createAsyncEvents(refreshedEvents));

    render(<TasksPage client={client} />);
    await screen.findByRole("heading", { name: "eval" });

    await userEvent.click(screen.getByRole("button", { name: /Load events/ }));
    expect(await screen.findByText("4 events")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "刷新任务" }));

    expect(await screen.findByText(/events refreshed/)).toBeInTheDocument();
    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(client.streamTaskEvents).toHaveBeenCalledTimes(2);
  });

  it("renders scan progress with an unknown total as an indeterminate count", async () => {
    const client = createMockClient();
    const zeroTotalScanEvents: TaskEvent[] = [
      {
        type: "progress",
        seq: 1,
        ts: "2026-05-05T09:37:12Z",
        phase: "scan",
        current: 0,
        total: 0
      },
      {
        type: "progress",
        seq: 2,
        ts: "2026-05-05T09:37:15Z",
        phase: "scan",
        current: 42,
        total: 0,
        detail: { path: "sources/architecture.md" }
      }
    ];
    client.get.mockResolvedValue(taskRowsFixture);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(zeroTotalScanEvents));

    render(<TasksPage client={client} />);
    await screen.findByRole("heading", { name: "eval" });

    await userEvent.click(screen.getByRole("button", { name: /Load events/ }));

    expect(await screen.findByText("已扫描 42 · 总量未知")).toBeInTheDocument();
    expect(screen.queryByText("42/0")).not.toBeInTheDocument();
  });

  it("keeps completed task event loading available while another task is being followed", async () => {
    const client = createMockClient();
    const mixedRows: TaskRow[] = [
      {
        task_id: "synth-running-1",
        op: "synth",
        status: "running",
        created_at: "2026-05-05T10:00:00Z",
        started_at: "2026-05-05T10:00:01Z",
        finished_at: null,
        params_digest: "running",
        result: null,
        error: null
      },
      {
        task_id: "ingest-done-1",
        op: "ingest",
        status: "succeeded",
        created_at: "2026-05-05T09:00:00Z",
        started_at: "2026-05-05T09:00:01Z",
        finished_at: "2026-05-05T09:00:03Z",
        params_digest: "done",
        result: { scanned: 1, added: 1 },
        error: null
      }
    ];
    const runningEvents: TaskEvent[] = [
      {
        type: "progress",
        seq: 1,
        ts: "2026-05-05T10:00:02Z",
        phase: "synth",
        current: 1,
        total: 3
      }
    ];
    const doneEvents: TaskEvent[] = [
      {
        type: "task_started",
        seq: 1,
        ts: "2026-05-05T09:00:01Z",
        task_id: "ingest-done-1",
        op: "ingest"
      },
      {
        type: "final",
        seq: 2,
        ts: "2026-05-05T09:00:03Z",
        status: "succeeded",
        result: { scanned: 1, added: 1 },
        error: null
      }
    ];
    client.get.mockResolvedValue(mixedRows);
    client.streamTaskEvents.mockImplementation((taskId: string) =>
      taskId === "synth-running-1" ? createPendingEvents(runningEvents) : createAsyncEvents(doneEvents)
    );

    render(<TasksPage client={client} />);
    expect(await screen.findByRole("heading", { name: "synth" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Follow/ }));
    expect(await screen.findByText("1 events")).toBeInTheDocument();
    await userEvent.click(screen.getByText("ingest-done-1").closest("button") as HTMLElement);

    const loadEvents = screen.getByRole("button", { name: /Load events/ });
    expect(loadEvents).toBeEnabled();
    await userEvent.click(loadEvents);

    expect(await screen.findByText("2 events")).toBeInTheDocument();
    expect(client.streamTaskEvents).toHaveBeenLastCalledWith("ingest-done-1", undefined, expect.any(AbortSignal));
  });
});

async function* createPendingEvents<T>(events: T[]): AsyncGenerator<T> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
  await new Promise(() => undefined);
}
