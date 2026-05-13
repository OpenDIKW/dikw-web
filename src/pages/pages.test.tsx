import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphPage } from "./GraphPage";
import { OverviewPage } from "./OverviewPage";
import { ChatPage } from "./ChatPage";
import { RetrievePage } from "./RetrievePage";
import { TasksPage } from "./TasksPage";
import { WikiPage } from "./WikiPage";
import { WisdomPage } from "./WisdomPage";
import type { AgentClientLike } from "./agentTypes";
import type { AgentStreamEvent } from "../agent/types";
import {
  createAsyncEvents,
  healthFixture,
  infoFixture,
  ingestFileErrorEventsFixture,
  retrieveEventsFixture,
  sourcePagesFixture,
  statusFixture,
  taskEventsFixture,
  taskRowsFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
  wisdomItemsFixture
} from "../test/fixtures";
import { createMockClient } from "../test/mockClient";
import type { DocumentRecord, PageReadResult, TaskEvent, TaskRow } from "../types";

describe("read console pages", () => {
  it("loads overview status from the client", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/health") {
        return Promise.resolve(healthFixture);
      }
      if (path === "/v1/info") {
        return Promise.resolve(infoFixture);
      }
      if (path === "/v1/status") {
        return Promise.resolve(statusFixture);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<OverviewPage client={client} />);

    expect(await screen.findByText("dikw-core 0.2.0")).toBeInTheDocument();
    expect(screen.getByText("C:\\demo\\base")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "anthropic_compat · MiniMax-M2.7")).toBeInTheDocument();
    expect(within(screen.getByText("Wisdom").closest("section") as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("refreshes overview status from the header action", async () => {
    const client = createMockClient();
    let healthReads = 0;
    let statusReads = 0;
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/health") {
        healthReads += 1;
        return Promise.resolve({
          ...healthFixture,
          version: healthReads === 1 ? "0.2.0" : "0.2.1",
          layer_counts: {
            ...healthFixture.layer_counts,
            sources: healthReads === 1 ? 2 : 42
          }
        });
      }
      if (path === "/v1/info") {
        return Promise.resolve(infoFixture);
      }
      if (path === "/v1/status") {
        statusReads += 1;
        return Promise.resolve({
          ...statusFixture,
          documents_by_layer: {
            ...statusFixture.documents_by_layer,
            source: statusReads === 1 ? 2 : 42
          }
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<OverviewPage client={client} />);

    expect(await screen.findByText("dikw-core 0.2.0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh overview" }));

    expect(await screen.findByText("dikw-core 0.2.1")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(6);
  });

  it("loads wiki pages, renders markdown, and follows wikilinks", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === "/v1/base/pages") {
        expect(options?.params).toEqual({ active: true });
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    expect(screen.getByText("wiki · 1 anchor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Synthesis" }));
    expect(await screen.findByText("Synthesis Body.")).toBeInTheDocument();
  });

  it("loads base pages without a layer selector and shows the base directory tree", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === "/v1/base/pages") {
        expect(options?.params).toEqual({ active: true });
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["wiki/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(screen.queryByLabelText("Layer")).not.toBeInTheDocument();
    const directory = await screen.findByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "base" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: "wiki" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: "sources" })).toBeInTheDocument();
    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
  });

  it("renders wiki pages as a directory tree and opens wikilinks in the preview panel", async () => {
    const client = createMockClient();
    const treePages: DocumentRecord[] = [
      {
        doc_id: "wiki-dikw-core",
        path: "wiki/entities/dikw-core.md",
        path_key: "wiki/entities/dikw-core.md",
        title: "dikw-core",
        hash: "hash-core",
        mtime: 1777820000,
        layer: "wiki",
        active: true
      },
      {
        doc_id: "wiki-dikw-pyramid",
        path: "wiki/concepts/pyramid-diagram.md",
        path_key: "wiki/concepts/pyramid-diagram.md",
        title: "DIKW 金字塔",
        hash: "hash-pyramid",
        mtime: 1777820100,
        layer: "wiki",
        active: true
      }
    ];
    const treeBodies: Record<string, PageReadResult> = {
      "wiki/entities/dikw-core.md": {
        doc_id: "wiki-dikw-core",
        path: "wiki/entities/dikw-core.md",
        layer: "wiki",
        title: "dikw-core",
        body: "# dikw-core\n\nRead about [[DIKW pyramid]].",
        anchors: [{ chunk_id: 301, seq: 1, start: 0, end: 22 }]
      },
      "wiki/concepts/pyramid-diagram.md": {
        doc_id: "wiki-dikw-pyramid",
        path: "wiki/concepts/pyramid-diagram.md",
        layer: "wiki",
        title: "DIKW 金字塔",
        body: "# DIKW 金字塔\n\nPreview body for the pyramid concept.",
        anchors: [{ chunk_id: 302, seq: 1, start: 0, end: 34 }]
      }
    };
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(treePages);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(treeBodies[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    const directory = await screen.findByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "base" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: /wiki/ })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "dikw-core", level: 1 });
    expect(within(directory).getByRole("treeitem", { name: /entities/ })).toBeInTheDocument();
    expect(await within(directory).findByRole("button", { name: /dikw-core/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "dikw-core", level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Wiki link preview" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "DIKW pyramid" }));

    const preview = screen.getByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByRole("heading", { name: "DIKW 金字塔" })).toBeInTheDocument();
    expect(within(preview).getByText("wiki/concepts/pyramid-diagram.md")).toBeInTheDocument();
    expect(within(preview).getByText("Preview body for the pyramid concept.")).toBeInTheDocument();
    expect(within(screen.getByRole("main", { name: "Wiki reader" })).getByRole("heading", { name: "dikw-core", level: 1 })).toBeInTheDocument();

    await userEvent.click(within(preview).getByRole("button", { name: "Collapse link preview" }));

    expect(screen.queryByRole("region", { name: "Wiki link preview" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("main", { name: "Wiki reader" })).getByRole("heading", { name: "dikw-core", level: 1 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "DIKW pyramid" }));
    const reopenedPreview = screen.getByRole("region", { name: "Wiki link preview" });
    await userEvent.click(within(reopenedPreview).getByRole("button", { name: "Open as main document" }));

    expect(await within(screen.getByRole("main", { name: "Wiki reader" })).findByRole("heading", { name: "DIKW 金字塔", level: 1 })).toBeInTheDocument();
  });

  it("expands matching wiki tree branches while filtering", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([
          {
            doc_id: "wiki-dikw-core",
            path: "wiki/entities/dikw-core.md",
            path_key: "wiki/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "wiki",
            active: true
          },
          {
            doc_id: "wiki-dikw-pyramid",
            path: "wiki/concepts/dikw-pyramid.md",
            path_key: "wiki/concepts/dikw-pyramid.md",
            title: "DIKW pyramid",
            hash: "hash-pyramid",
            mtime: 1777820100,
            layer: "wiki",
            active: true
          }
        ] satisfies DocumentRecord[]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          doc_id: selectedPath,
          path: selectedPath,
          layer: "wiki",
          title: selectedPath.includes("pyramid") ? "DIKW pyramid" : "dikw-core",
          body: selectedPath.includes("pyramid") ? "# DIKW pyramid\n\nPyramid body." : "# dikw-core\n\nCore body.",
          anchors: []
        } satisfies PageReadResult);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    await screen.findByRole("heading", { name: "dikw-core", level: 1 });
    await userEvent.type(screen.getByLabelText("Filter"), "pyramid");

    const directory = screen.getByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "wiki" })).toHaveAttribute("aria-expanded", "true");
    expect(within(directory).getByRole("treeitem", { name: "concepts" })).toHaveAttribute("aria-expanded", "true");
    expect(await within(directory).findByRole("button", { name: /DIKW pyramid/ })).toBeInTheDocument();
    expect(within(directory).queryByRole("button", { name: /dikw-core/ })).not.toBeInTheDocument();
  });

  it("clears the reader when closing the directory that contains the selected page", async () => {
    const client = createMockClient();
    let bodyReads = 0;
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([
          {
            doc_id: "wiki-dikw-core",
            path: "wiki/entities/dikw-core.md",
            path_key: "wiki/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "wiki",
            active: true
          },
          {
            doc_id: "wiki-dikw-pyramid",
            path: "wiki/concepts/dikw-pyramid.md",
            path_key: "wiki/concepts/dikw-pyramid.md",
            title: "DIKW pyramid",
            hash: "hash-pyramid",
            mtime: 1777820100,
            layer: "wiki",
            active: true
          }
        ] satisfies DocumentRecord[]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        bodyReads += 1;
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          doc_id: selectedPath,
          path: selectedPath,
          layer: "wiki",
          title: selectedPath.includes("pyramid") ? "DIKW pyramid" : "dikw-core",
          body: selectedPath.includes("pyramid") ? "# DIKW pyramid\n\nPyramid body." : "# dikw-core\n\nCore body with [[DIKW pyramid]].",
          anchors: []
        } satisfies PageReadResult);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wiki reader" });
    const directory = await screen.findByRole("tree", { name: "Base directory" });
    expect(await within(reader).findByRole("heading", { name: "dikw-core", level: 1 })).toBeInTheDocument();

    await userEvent.click(within(reader).getByRole("button", { name: "DIKW pyramid" }));
    expect(screen.getByRole("region", { name: "Wiki link preview" })).toBeInTheDocument();

    await userEvent.click(within(directory).getByRole("button", { name: "concepts" }));
    expect(within(reader).getByRole("heading", { name: "dikw-core", level: 1 })).toBeInTheDocument();

    await userEvent.click(within(directory).getByRole("button", { name: "entities" }));

    expect(within(directory).getByRole("treeitem", { name: "entities" })).toHaveAttribute("aria-expanded", "false");
    expect(within(reader).queryByRole("heading", { name: "dikw-core", level: 1 })).not.toBeInTheDocument();
    expect(within(reader).getByText("Select a document to start reading")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Wiki link preview" })).not.toBeInTheDocument();

    const readsAfterClear = bodyReads;
    await userEvent.click(screen.getByRole("button", { name: "Refresh knowledge" }));

    expect(bodyReads).toBe(readsAfterClear);
  });

  it("shows an unresolved wikilink preview and can filter by the missing target", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([
          {
            doc_id: "wiki-dikw-core",
            path: "wiki/entities/dikw-core.md",
            path_key: "wiki/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "wiki",
            active: true
          }
        ] satisfies DocumentRecord[]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        return Promise.resolve({
          doc_id: "wiki-dikw-core",
          path: "wiki/entities/dikw-core.md",
          layer: "wiki",
          title: "dikw-core",
          body: "# dikw-core\n\nSee [[Missing Concept]].",
          anchors: []
        } satisfies PageReadResult);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    await userEvent.click(await screen.findByRole("button", { name: "Missing Concept" }, { timeout: 5_000 }));

    const preview = screen.getByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByRole("heading", { name: "Linked page not found" })).toBeInTheDocument();
    expect(within(preview).getByText("Missing Concept")).toBeInTheDocument();

    await userEvent.click(within(preview).getByRole("button", { name: "Filter directory by target" }));

    expect(screen.getByLabelText("Filter")).toHaveValue("Missing Concept");
  });

  it("refreshes the selected wiki page body from the header action", async () => {
    const client = createMockClient();
    let bodyReads = 0;
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/base/pages/")) {
        bodyReads += 1;
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          ...wikiPageBodiesFixture[selectedPath],
          body: bodyReads === 1 ? "Original Body." : "Updated Body."
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Original Body.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh knowledge" }));

    expect(await screen.findByText("Updated Body.")).toBeInTheDocument();
  });

  it("shows the wiki reader as read, info, outline, and source tabs", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          ...wikiPageBodiesFixture[selectedPath],
          body:
            "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\nstatus: draft\n---\n\n# Architecture\n\nLayered DIKW notes.\n\n[Jump to data flow](#data-flow)\n\n## Data flow\n\nSee [[Synthesis]]."
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wiki reader" });
    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    expect(within(reader).getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
    expect(within(reader).queryByRole("button", { name: "Generate explainer" })).not.toBeInTheDocument();
    expect(within(reader).queryByLabelText("Document metadata")).not.toBeInTheDocument();

    await userEvent.click(within(reader).getByRole("tab", { name: "Info" }));

    expect(within(reader).getAllByText("wiki/architecture.md").length).toBeGreaterThan(0);
    expect(within(reader).getByText("draft")).toBeInTheDocument();
    expect(within(reader).getByText("#DIKW")).toBeInTheDocument();
    expect(within(reader).getByText("source/a.md")).toBeInTheDocument();

    await userEvent.click(within(reader).getByRole("tab", { name: "Outline" }));

    expect(within(reader).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(within(reader).getByRole("heading", { name: "Data flow" })).toBeInTheDocument();
    await userEvent.click(within(reader).getByRole("button", { name: "Synthesis" }));
    expect(await screen.findByRole("region", { name: "Wiki link preview" })).toBeInTheDocument();
    expect(within(reader).queryByText("Synthesis Body.")).not.toBeInTheDocument();

    await userEvent.click(within(reader).getByRole("tab", { name: "Source" }));

    expect(within(reader).getByText(/title: Architecture/)).toBeInTheDocument();
    expect(within(reader).getByText(/\[\[Synthesis\]\]/)).toBeInTheDocument();
  });

  it("keeps wiki hash routing intact when clicking markdown heading links", async () => {
    const client = createMockClient();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#wiki";
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          ...wikiPageBodiesFixture[selectedPath],
          body: "# Architecture\n\n[Jump to Data flow](#data-flow)\n\n## Data flow\n\nLayered DIKW notes."
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    try {
      render(<WikiPage client={client} />);

      await userEvent.click(await screen.findByRole("link", { name: "Jump to Data flow" }));

      expect(window.location.hash).toBe("#wiki");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("heading", { name: "Architecture", level: 1 })).toBeInTheDocument();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("loads base pages into a default wiki graph", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === "/v1/base/pages") {
        expect(options?.params).toEqual({ active: true });
        return Promise.resolve([...wikiPagesFixture, ...sourcePagesFixture]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<GraphPage client={client} />);

    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
    expect(screen.getByText("0 unresolved")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Knowledge graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Architecture graph node" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();
    expect(screen.getByLabelText("Repel strength")).toBeInTheDocument();
    expect(screen.getByLabelText("Link distance")).toBeInTheDocument();
    expect(screen.getByLabelText("Node size")).toBeInTheDocument();
    expect(screen.getByLabelText("Link thickness")).toBeInTheDocument();
    expect(client.get).not.toHaveBeenCalledWith("/v1/base/pages/sources/architecture.md", expect.anything());
  });

  it("renders a partial graph when one page body times out", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string, options?: { signal?: AbortSignal }) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(wikiPagesFixture);
      }
      if (path === "/v1/base/pages/wiki/architecture.md") {
        return Promise.resolve(wikiPageBodiesFixture["wiki/architecture.md"]);
      }
      if (path === "/v1/base/pages/wiki/synthesis.md") {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
        });
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<GraphPage client={client} pageReadTimeoutMs={5} />);

    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
    expect(screen.getByText("1 skipped")).toBeInTheDocument();
    expect(screen.getByText("Some page bodies could not be read. The graph continues with returned pages.")).toBeInTheDocument();
  });

  it("filters graph nodes, focuses neighbors, and opens the selected node in wiki", async () => {
    const client = createMockClient();
    const openedPaths: string[] = [];
    const graphPages: DocumentRecord[] = [
      ...wikiPagesFixture,
      {
        doc_id: "wiki-orphan",
        path: "wiki/orphan.md",
        path_key: "wiki/orphan.md",
        title: "Orphan",
        hash: "hash-o",
        mtime: 1777819400,
        layer: "wiki",
        active: true
      }
    ];
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve(graphPages);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        if (selectedPath === "wiki/orphan.md") {
          return Promise.resolve({
            doc_id: "wiki-orphan",
            path: "wiki/orphan.md",
            layer: "wiki",
            title: "Orphan",
            body: "# Orphan\n\nNo links.",
            anchors: []
          } satisfies PageReadResult);
        }
        if (selectedPath === "wiki/architecture.md") {
          return Promise.resolve({
            ...wikiPageBodiesFixture["wiki/architecture.md"],
            body: "# Architecture\n\nSee [[Synthesis]] and [[Missing Concept]]."
          });
        }
        return Promise.resolve(wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<GraphPage client={client} onOpenWikiPath={(path) => openedPaths.push(path)} />);

    expect(await screen.findByText("3 nodes")).toBeInTheDocument();
    expect(screen.getByText("1 unresolved")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Graph search"), "synth");

    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Architecture graph node" })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Graph search"));
    await userEvent.click(screen.getByLabelText("Hide orphans"));

    expect(screen.queryByRole("button", { name: "Orphan graph node" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Architecture graph node" }));

    const detail = screen.getByRole("region", { name: "Graph node detail" });
    expect(within(detail).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(within(detail).getByText("0 inbound")).toBeInTheDocument();
    expect(within(detail).getByText("1 outbound")).toBeInTheDocument();
    expect(within(detail).getByText("Missing Concept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Architecture graph node" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toHaveAttribute("data-muted", "false");

    await userEvent.click(within(detail).getByRole("button", { name: "Open in Knowledge" }));

    expect(openedPaths).toEqual(["wiki/architecture.md"]);
  });

  it("loads wisdom items and refetches when filters change", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue(wisdomItemsFixture);

    render(<WisdomPage client={client} />);

    expect(await screen.findByRole("heading", { name: "Prefer evidence" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "approved");

    await waitFor(() => {
      expect(client.get).toHaveBeenLastCalledWith(
        "/v1/wisdom",
        expect.objectContaining({
          params: expect.objectContaining({ status: "approved" })
        })
      );
    });
  });

  it("presents wisdom as a selectable library with a detail reader", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue([
      wisdomItemsFixture[0],
      {
        ...wisdomItemsFixture[0],
        item_id: "wisdom-2",
        kind: "lesson",
        status: "approved",
        title: "Trace sources",
        body: "Link each claim to its source path.",
        confidence: 0.91
      }
    ]);

    render(<WisdomPage client={client} />);

    const library = await screen.findByRole("list", { name: "Wisdom library" });
    expect(within(library).getByRole("button", { name: /Prefer evidence/ })).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Wisdom detail" });
    expect(within(detail).getByRole("heading", { name: "Prefer evidence" })).toBeInTheDocument();

    await userEvent.click(within(library).getByRole("button", { name: /Trace sources/ }));

    expect(within(detail).getByRole("heading", { name: "Trace sources" })).toBeInTheDocument();
    expect(within(detail).getByText("Link each claim to its source path.")).toBeInTheDocument();
    expect(within(detail).getByText("approved", { selector: ".status-pill" })).toBeInTheDocument();
  });

  it("runs chat streams without calling the removed query endpoint", async () => {
    const agentClient: AgentClientLike = {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({
        id: "session-1",
        title: "New chat",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        messageCount: 0,
        lastMessagePreview: "",
        messages: [],
        toolEvents: [],
        sources: [],
        proposals: []
      }),
      getSession: vi.fn().mockResolvedValue({
        id: "session-1",
        title: "What is DIKW?",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:01.000Z",
        messageCount: 2,
        lastMessagePreview: "Layered answer.",
        messages: [
          { id: "m1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
          {
            id: "m2",
            role: "assistant",
            content: "## Layered answer\n\nUse **evidence**.",
            createdAt: "2026-05-13T00:00:01.000Z",
            turnId: "turn-1"
          }
        ],
        toolEvents: [
          {
            id: "tool-1",
            type: "tool_call",
            name: "retrieve_knowledge",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z",
            turnId: "turn-1"
          }
        ],
        sources: [{ path: "wiki/architecture.md", title: "Architecture", layer: "wiki", turnId: "turn-1" }],
        proposals: []
      }),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() =>
        createAsyncEvents([
          { type: "message_delta", sessionId: "session-1", delta: "## Layered answer\n\nUse **evidence**." },
          {
            type: "tool_event",
            sessionId: "session-1",
            event: {
              id: "tool-1",
              type: "tool_call",
              name: "retrieve_knowledge",
              status: "succeeded",
              createdAt: "2026-05-13T00:00:00.500Z",
              turnId: "turn-1"
            }
          },
          {
            type: "source",
            sessionId: "session-1",
            source: { path: "wiki/architecture.md", title: "Architecture", layer: "wiki", turnId: "turn-1" }
          },
          { type: "agent_end", sessionId: "session-1" }
        ] satisfies AgentStreamEvent[])
      )
    };
    render(<ChatPage agentClient={agentClient} />);
    await userEvent.type(await screen.findByLabelText("Message"), "What is DIKW?");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    expect(await screen.findByRole("heading", { name: "Layered answer" })).toBeInTheDocument();
    expect(screen.getByText("evidence", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("retrieve_knowledge")).toHaveClass("tool-call__name");
    expect(screen.getByTitle("Succeeded")).toHaveClass("tool-call--succeeded");
    expect(screen.getByText("wiki/architecture.md")).toBeInTheDocument();
    expect(agentClient.sendMessage).toHaveBeenCalledWith("session-1", "What is DIKW?", expect.any(AbortSignal));
  });

  it("uses chat terminology and renames sessions inline", async () => {
    const activeSession = {
      id: "session-1",
      title: "New chat",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      messageCount: 0,
      lastMessagePreview: "",
      messages: [],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const renamedSession = {
      ...activeSession,
      title: "Project Review",
      updatedAt: "2026-05-13T00:00:01.000Z"
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn().mockResolvedValue(renamedSession),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike & { renameSession: ReturnType<typeof vi.fn> };

    render(<ChatPage agentClient={agentClient} />);

    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Chat history" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent Chat" })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Rename chat New chat" }));
    await userEvent.clear(screen.getByLabelText("Chat title"));
    await userEvent.type(screen.getByLabelText("Chat title"), "Project Review");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));

    await waitFor(() => {
      expect(agentClient.renameSession).toHaveBeenCalledWith("session-1", "Project Review");
      expect(within(screen.getByRole("complementary", { name: "Chat history" })).getByText("Project Review", { selector: "strong" })).toBeInTheDocument();
    });
  });

  it("filters chat sources and tool calls by the selected assistant turn", async () => {
    const activeSession = {
      id: "session-1",
      title: "Turn context",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:04.000Z",
      messageCount: 4,
      lastMessagePreview: "Second answer",
      messages: [
        { id: "u1", role: "user", content: "First question", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "First answer", createdAt: "2026-05-13T00:00:01.000Z", turnId: "turn-1" },
        { id: "u2", role: "user", content: "Second question", createdAt: "2026-05-13T00:00:03.000Z", turnId: "turn-2" },
        { id: "a2", role: "assistant", content: "Second answer", createdAt: "2026-05-13T00:00:04.000Z", turnId: "turn-2" }
      ],
      toolEvents: [
        {
          id: "tool-1",
          type: "tool_call" as const,
          name: "read_page",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z",
          turnId: "turn-1"
        },
        {
          id: "tool-2",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:03.500Z",
          turnId: "turn-2"
        }
      ],
      sources: [
        { path: "wiki/first.md", title: "First", layer: "wiki", turnId: "turn-1" },
        { path: "wiki/second.md", title: "Second", layer: "wiki", turnId: "turn-2" }
      ],
      proposals: []
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);

    await waitFor(() => expect(screen.getAllByText("Second answer").length).toBeGreaterThan(0));
    const context = screen.getByRole("complementary", { name: "Context for this reply" });
    expect(within(context).getByText("wiki/second.md")).toBeInTheDocument();
    expect(within(context).getByText("retrieve_knowledge")).toBeInTheDocument();
    expect(within(context).queryByText("wiki/first.md")).not.toBeInTheDocument();
    expect(within(context).queryByText("read_page")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Agent: First answer/ }));

    expect(within(context).getByText("wiki/first.md")).toBeInTheDocument();
    expect(within(context).getByText("read_page")).toBeInTheDocument();
    expect(within(context).queryByText("wiki/second.md")).not.toBeInTheDocument();
  });

  it("does not fall back to older turn context when the latest assistant reply has no turn id", async () => {
    const activeSession = {
      id: "session-1",
      title: "Mixed history",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:04.000Z",
      messageCount: 4,
      lastMessagePreview: "Legacy answer",
      messages: [
        { id: "u1", role: "user", content: "First question", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "First answer", createdAt: "2026-05-13T00:00:01.000Z", turnId: "turn-1" },
        { id: "u2", role: "user", content: "Legacy question", createdAt: "2026-05-13T00:00:03.000Z" },
        { id: "a2", role: "assistant", content: "Legacy answer", createdAt: "2026-05-13T00:00:04.000Z" }
      ],
      toolEvents: [
        {
          id: "tool-1",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z",
          turnId: "turn-1"
        }
      ],
      sources: [{ path: "wiki/first.md", title: "First", layer: "wiki", turnId: "turn-1" }],
      proposals: []
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);

    await waitFor(() => expect(screen.getAllByText("Legacy answer").length).toBeGreaterThan(0));
    const context = screen.getByRole("complementary", { name: "Context for this reply" });
    expect(within(context).queryByText("wiki/first.md")).not.toBeInTheDocument();
    expect(within(context).queryByText("retrieve_knowledge")).not.toBeInTheDocument();
    expect(within(context).getByText("No sources for this reply")).toBeInTheDocument();
    expect(within(context).getByText("No tool calls for this reply")).toBeInTheDocument();
  });

  it("does not carry old sources or tool calls into a later reply without turn context", async () => {
    const initialSession = {
      id: "session-1",
      title: "Health check",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:02.000Z",
      messageCount: 2,
      lastMessagePreview: "Layered answer.",
      messages: [
        { id: "u1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "Layered answer.", createdAt: "2026-05-13T00:00:01.000Z", turnId: "turn-1" }
      ],
      toolEvents: [
        {
          id: "tool-1",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z",
          turnId: "turn-1"
        }
      ],
      sources: [{ path: "wiki/architecture.md", title: "Architecture", layer: "wiki", turnId: "turn-1" }],
      proposals: []
    };
    const refreshedSession = {
      ...initialSession,
      updatedAt: "2026-05-13T00:00:04.000Z",
      messageCount: 4,
      lastMessagePreview: "Health failed.",
      messages: [
        ...initialSession.messages,
        { id: "u2", role: "user", content: "Check health", createdAt: "2026-05-13T00:00:03.000Z", turnId: "turn-2" },
        { id: "a2", role: "assistant", content: "Health failed.", createdAt: "2026-05-13T00:00:04.000Z", turnId: "turn-2" }
      ]
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([initialSession]),
      createSession: vi.fn().mockResolvedValue(initialSession),
      getSession: vi.fn().mockResolvedValueOnce(initialSession).mockResolvedValueOnce(refreshedSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() =>
        createAsyncEvents([
          { type: "message_delta", sessionId: "session-1", delta: "Health failed." },
          { type: "agent_end", sessionId: "session-1" }
        ] satisfies AgentStreamEvent[])
      )
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);
    expect(await screen.findByText("wiki/architecture.md")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message"), "Check health");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    const context = screen.getByRole("complementary", { name: "Context for this reply" });
    await waitFor(() => expect(screen.getAllByText("Health failed.").length).toBeGreaterThan(0));
    expect(within(context).queryByText("wiki/architecture.md")).not.toBeInTheDocument();
    expect(within(context).getByText("No sources for this reply")).toBeInTheDocument();
    expect(within(context).getByText("No tool calls for this reply")).toBeInTheDocument();
  });

  it("uses a small header control for selecting a reply instead of making the whole assistant markdown a button", async () => {
    const activeSession = {
      id: "session-1",
      title: "Accessible selection",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:02.000Z",
      messageCount: 2,
      lastMessagePreview: "First answer",
      messages: [
        { id: "u1", role: "user", content: "First question", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "First answer", createdAt: "2026-05-13T00:00:01.000Z", turnId: "turn-1" }
      ],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);

    await screen.findByRole("button", { name: /Agent: First answer/ });
    const messageText = screen.getAllByText("First answer").find((node) => node.closest(".agent-message"));
    const message = messageText?.closest(".agent-message");
    expect(message).not.toHaveAttribute("role", "button");
    expect(within(message as HTMLElement).getByRole("button", { name: /Agent: First answer/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("keeps chat context inside the shared conversation scroll region while the composer stays fixed outside it", async () => {
    const activeSession = {
      id: "session-1",
      title: "Layout",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 2,
      lastMessagePreview: "Answer",
      messages: [
        { id: "u1", role: "user", content: "Question", createdAt: "2026-05-13T00:00:00.000Z", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "Answer", createdAt: "2026-05-13T00:00:01.000Z", turnId: "turn-1" }
      ],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);

    const scrollRegion = await screen.findByTestId("agent-conversation-scroll");
    const context = screen.getByRole("complementary", { name: "Context for this reply" });
    expect(scrollRegion).toContainElement(context);
    expect(within(scrollRegion).getByText("Sources")).toBeInTheDocument();
    expect(within(scrollRegion).getByText("Tool calls")).toBeInTheDocument();
    expect(scrollRegion).not.toContainElement(screen.getByLabelText("Message"));
    expect(scrollRegion).not.toContainElement(screen.getByRole("button", { name: /Send/ }));
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

  it("summarizes ingest file errors from partial events and final results", async () => {
    const client = createMockClient();
    const finalEvent = ingestFileErrorEventsFixture.find(
      (event): event is Extract<TaskEvent, { type: "final" }> => event.type === "final"
    );
    const ingestRows: TaskRow[] = [
      {
        task_id: "ingest-task-1",
        op: "ingest",
        status: "succeeded",
        created_at: "2026-05-05T09:37:11Z",
        started_at: "2026-05-05T09:37:11Z",
        finished_at: "2026-05-05T09:37:25Z",
        params_digest: "ingest",
        result: finalEvent?.result ?? null,
        error: null
      }
    ];
    client.get.mockResolvedValue(ingestRows);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(ingestFileErrorEventsFixture));

    render(<TasksPage client={client} />);

    expect(await screen.findByRole("heading", { name: "ingest" })).toBeInTheDocument();
    expect(screen.getByText("1 file error")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Load events/ }));

    expect((await screen.findAllByText("File error")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("parse_error").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sources/broken.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("invalid YAML front matter").length).toBeGreaterThan(0);
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

    await userEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));

    expect(await screen.findByText(/events refreshed/)).toBeInTheDocument();
    expect(screen.getByText("5 events")).toBeInTheDocument();
    expect(client.streamTaskEvents).toHaveBeenCalledTimes(2);
  });

  it("updates a followed task to its final status without a manual refresh", async () => {
    const client = createMockClient();
    const runningTask: TaskRow = {
      ...taskRowsFixture[0],
      task_id: "eval-running-1",
      status: "running",
      finished_at: null,
      result: null
    };
    const completedEvents: TaskEvent[] = [
      {
        type: "task_started",
        seq: 1,
        ts: "2026-05-05T09:37:11Z",
        task_id: "eval-running-1",
        op: "eval"
      },
      {
        type: "final",
        seq: 2,
        ts: "2026-05-05T09:37:25Z",
        status: "succeeded",
        result: taskRowsFixture[0].result,
        error: null
      }
    ];
    client.get.mockResolvedValue([runningTask]);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(completedEvents));

    render(<TasksPage client={client} />);

    const taskButton = (await screen.findByText("eval-running-1")).closest("button") as HTMLElement;
    expect(within(taskButton).getByText("running")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "eval" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Follow/ }));

    await waitFor(() => {
      expect(within(taskButton).getByText("succeeded")).toBeInTheDocument();
    });
    expect(within(taskButton).queryByText("running")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load events/ })).toBeEnabled();
    expect(screen.getAllByText("synthetic-diverse-v1").length).toBeGreaterThan(0);
  });

  it("localizes scan progress with an unknown total as an indeterminate count", async () => {
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

    expect(await screen.findByText("Waiting for count · total unknown")).toBeInTheDocument();
    expect(screen.getByText("Scanned 42 · total unknown")).toBeInTheDocument();
    expect(screen.queryByText("已扫描 42 · 总量未知")).not.toBeInTheDocument();
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
