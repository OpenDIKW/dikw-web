import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphPage } from "./GraphPage";
import { OverviewPage } from "./OverviewPage";
import { ChatPage } from "./ChatPage";
import { RetrievePage } from "./RetrievePage";
import { TasksPage } from "./TasksPage";
import { WikiPage } from "./WikiPage";
import type { AgentClientLike } from "./agentTypes";
import type { AgentStreamEvent } from "../agent/types";
import {
  createAsyncEvents,
  graphResultFixture,
  healthFixture,
  infoFixture,
  ingestFileErrorEventsFixture,
  manyTaskEventsFixture,
  manyTaskRowsFixture,
  manyTaskSummariesFixture,
  retrieveEventsFixture,
  sourcePagesFixture,
  statusFixture,
  taskEventsFixture,
  taskListPageFixture,
  taskRowsFixture,
  toTaskListPage,
  toTaskSummary,
  wikiPageBodiesFixture,
  wikiPagesFixture
} from "../test/fixtures";
import { createMockClient } from "../test/mockClient";
import { DikwClientError } from "../api/client";
import type { DocumentRecord, PageLinksResult, PageReadResult, TaskEvent, TaskListPage, TaskRow } from "../types";

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
    expect(screen.getByText("knowledge · 1 anchor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Synthesis" }));
    expect(await screen.findByText("Synthesis Body.")).toBeInTheDocument();
  });

  it("inlines source-page backlinks into the body and opens preview on click", async () => {
    const client = createMockClient();
    const linksCalls: string[] = [];
    client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        linksCalls.push(path);
        expect(options?.params).toEqual({ direction: "in" });
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: [
            { src_doc_id: "knowledge-architecture", src_path: "knowledge/architecture.md", link_type: "wikilink", anchor: null, line: 3 }
          ]
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        // This test isolates the body-wikilink backlinks channel — return a
        // 404 so the source reader degrades to /links-only without the
        // provenance fallthrough silently re-shaping the panel.
        return Promise.reject(
          new DikwClientError({ status: 404, code: "not_found", message: "endpoint unavailable" })
        );
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    // Default selection is a wiki page: no /links request, no backlinks region.
    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    expect(linksCalls).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Linked references" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Body backlink 'Architecture' 在源 body 里有字面命中 → 走 inline,不在 panel 里。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    await waitFor(() => expect(linksCalls).toHaveLength(1));
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    expect(inlineButton).toHaveClass("inline-wikilink");

    await userEvent.click(inlineButton);
    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("knowledge/architecture.md")).toBeInTheDocument();
  });

  it("inlines matched K-pages into the source body and lists unmatched ones in the panel", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: [
            { src_doc_id: "knowledge-architecture", src_path: "knowledge/architecture.md", link_type: "wikilink", anchor: null, line: 3 }
          ]
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-architecture", path: "knowledge/architecture.md", title: "Architecture" },
            { doc_id: "knowledge-synthesis", path: "knowledge/synthesis.md", title: "Synthesis" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Body 内联:fixture body 含 "Architecture" — 应该被注入为 inline wikilink button。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    expect(inlineButton).toHaveClass("inline-wikilink");

    // Panel: 只剩 Synthesis(body 中无字面 "Synthesis")。
    const refs = within(reader).getByRole("region", { name: "Linked references" });
    expect(within(refs).getByRole("button", { name: "Synthesis" })).toBeInTheDocument();
    expect(within(refs).queryByRole("button", { name: "Architecture" })).not.toBeInTheDocument();

    // Synthesis 在 panel 里只有 sourced chip(matched 的 Architecture 不出现)。
    expect(within(refs).getByText("sourced")).toBeInTheDocument();
    expect(within(refs).queryByText("linked")).not.toBeInTheDocument();
  });

  it("opens the K-page preview when an inline injected wikilink is clicked", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-architecture", path: "knowledge/architecture.md", title: "Architecture" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    await userEvent.click(inlineButton);

    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("knowledge/architecture.md")).toBeInTheDocument();
  });

  it("renders the original source body verbatim in the Source tab (no inline injection)", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-architecture", path: "knowledge/architecture.md", title: "Architecture" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Wait for inline injection on the Read tab — confirms /provenance landed
    // and refs memo settled before we flip to the Source tab.
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    await within(readTab).findByRole("button", { name: "Architecture" });

    await userEvent.click(screen.getByRole("tab", { name: /Source/ }));

    const sourceTab = await screen.findByRole("tabpanel", { name: /Source/ });
    // The raw source code <pre> renders the original body — no [[...|...]] markers.
    expect(within(sourceTab).getByText(/The Architecture is the main topic/)).toBeInTheDocument();
    expect(within(sourceTab).queryByText(/\[\[Architecture\|Architecture\]\]/)).not.toBeInTheDocument();
  });

  it("opens a cache-lag provenance reference even when its path is not yet in pages.data", async () => {
    // The K-page is freshly synthesized in core but the cached
    // /v1/base/pages list still lags behind — resolveDerivedPages renders
    // the entry using the wire title (its cache-lag fallback), so the
    // click handler must still be able to open the preview without
    // requiring the entry to appear in pages.data. Otherwise we ship a
    // dead button.
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        // Note: knowledge/fresh-k.md intentionally NOT in the page list.
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-fresh-k", path: "knowledge/fresh-k.md", title: "Fresh K-page" }
          ]
        });
      }
      if (path === "/v1/base/pages/knowledge/fresh-k.md") {
        // Preview fetch goes straight to core by path — pages.data is not
        // consulted for the body read.
        return Promise.resolve({
          doc_id: "knowledge-fresh-k",
          path: "knowledge/fresh-k.md",
          layer: "knowledge",
          title: "Fresh K-page",
          body: "Body of fresh K-page.",
          anchors: [],
          assets: []
        } satisfies PageReadResult);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    const refs = await screen.findByRole("region", { name: "Linked references" });
    const freshButton = await within(refs).findByRole("button", { name: "Fresh K-page" });

    await userEvent.click(freshButton);

    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("knowledge/fresh-k.md")).toBeInTheDocument();
    // The selection-effect at L114 (WikiPage) forces any selectedPath
    // outside visiblePages back to the default page, so the "Open as
    // main document" button would silently fail for a cache-lag stub.
    // Hide it instead of shipping a dead button.
    expect(within(preview).queryByRole("button", { name: "Open as main document" })).not.toBeInTheDocument();
  });

  it("keeps a cache-lag K-page in the bottom panel even when its title literally appears in the source body", async () => {
    // 没有这个保护时:injectInlineRefs 会把 "Emergent" 字面命中后从 panel
    // 移除,但 inline 按钮的 openWikiLink("Emergent") → findPageForTarget
    // 在 pages.data 里找不到 knowledge/emergent.md,返回 not-found —— dead link。
    // 修复后:cache-lag ref 不参与 inline 注入,留在 panel,由 openBacklink
    // 的 path-based fallback 直接打开 preview。
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        // knowledge/emergent.md 故意没放进 page list,模拟 cache lag。
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: []
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-emergent", path: "knowledge/emergent.md", title: "Emergent" }
          ]
        });
      }
      if (path === "/v1/base/pages/sources/architecture.md") {
        // 自定义 body —— 含字面 "Emergent" 触发本测试的关键路径。
        return Promise.resolve({
          doc_id: "source-architecture",
          path: "sources/architecture.md",
          layer: "source",
          title: "Architecture source",
          body: "# Architecture source\n\nThe Emergent behavior is interesting.",
          anchors: [],
          assets: []
        } satisfies PageReadResult);
      }
      if (path === "/v1/base/pages/knowledge/emergent.md") {
        return Promise.resolve({
          doc_id: "knowledge-emergent",
          path: "knowledge/emergent.md",
          layer: "knowledge",
          title: "Emergent",
          body: "Body of Emergent.",
          anchors: [],
          assets: []
        } satisfies PageReadResult);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Panel: 含 Emergent 按钮 —— 没被 inline 吃掉。
    const refs = await screen.findByRole("region", { name: "Linked references" });
    const panelButton = await within(refs).findByRole("button", { name: "Emergent" });

    // Markdown body 里 "Emergent" 仍为纯文本,没有 inline-wikilink 按钮 ——
    // panel 里那个 Emergent 按钮 sits 在同一个 tabpanel 但在 .wiki-backlinks 里,
    // 所以这里要拿 .markdown-body scope 才能区分。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const markdownBody = reader.querySelector(".markdown-body") as HTMLElement | null;
    expect(markdownBody).not.toBeNull();
    expect(within(markdownBody!).queryByRole("button", { name: "Emergent" })).not.toBeInTheDocument();
    expect(within(markdownBody!).getByText(/Emergent behavior is interesting/)).toBeInTheDocument();

    // 点击 panel 里的按钮 → preview 打开(由 openBacklink path-based fallback 兜底)。
    await userEvent.click(panelButton);
    const preview = await screen.findByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByText("knowledge/emergent.md")).toBeInTheDocument();
  });

  it.each([
    [404, "not_found"],
    [405, "method_not_allowed"]
  ])("silently degrades when /provenance returns %i", async (status, code) => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        return Promise.resolve({
          path: "sources/architecture.md",
          outgoing: [],
          incoming: [
            { src_doc_id: "knowledge-architecture", src_path: "knowledge/architecture.md", link_type: "wikilink", anchor: null, line: 3 }
          ]
        } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        return Promise.reject(new DikwClientError({ status, code, message: "endpoint unavailable" }));
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));

    // Architecture 在 body 中有字面命中 → 走 inline,不在 panel。Synthesis 既无 link
    // 也无 provenance(404 degrades)。panel 因为没有 unlinked refs 不渲染。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const inlineButton = await within(readTab).findByRole("button", { name: "Architecture" });
    expect(inlineButton).toHaveClass("inline-wikilink");
    expect(within(reader).queryByRole("region", { name: "Linked references" })).not.toBeInTheDocument();
    // No top-level error notice was rendered for the 404.
    expect(screen.queryByText(/endpoint unavailable/)).not.toBeInTheDocument();
  });

  it("treats stale /provenance responses for a different source path as no-op", async () => {
    const client = createMockClient();
    const secondSource: DocumentRecord = {
      doc_id: "source-synthesis-notes",
      path: "sources/synthesis-notes.md",
      path_key: "sources/synthesis-notes.md",
      title: "Synthesis notes",
      hash: "hash-src-sn",
      mtime: 1777819000,
      layer: "source",
      active: true
    };
    const sourceBodies: Record<string, PageReadResult> = {
      "sources/architecture.md": {
        doc_id: "source-architecture",
        path: "sources/architecture.md",
        layer: "source",
        title: "Architecture source",
        body: "Body of architecture source.",
        anchors: [],
        assets: []
      },
      "sources/synthesis-notes.md": {
        doc_id: "source-synthesis-notes",
        path: "sources/synthesis-notes.md",
        layer: "source",
        title: "Synthesis notes",
        body: "Body of synthesis notes source.",
        anchors: [],
        assets: []
      }
    };
    let resolveStaleProvenance: ((value: unknown) => void) | null = null;
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([secondSource, ...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        const target = decodeURIComponent(path.replace("/v1/base/pages/", "").replace(/\/links$/, ""));
        return Promise.resolve({ path: target, outgoing: [], incoming: [] } satisfies PageLinksResult);
      }
      if (path.endsWith("/provenance")) {
        const target = decodeURIComponent(path.replace("/v1/base/pages/", "").replace(/\/provenance$/, ""));
        if (target === "sources/architecture.md") {
          // Park this response until after we've switched to the other source.
          return new Promise((resolve) => {
            resolveStaleProvenance = resolve;
          });
        }
        return Promise.resolve({
          path: target,
          derived_from: [],
          derived_pages: [{ doc_id: "knowledge-synthesis", path: "knowledge/synthesis.md", title: "Synthesis" }]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(sourceBodies[selectedPath] ?? wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    await userEvent.click(await screen.findByRole("button", { name: "sources" }));
    await userEvent.click(screen.getByRole("button", { name: /Architecture source/ }));
    // Body 中 "architecture" 命中 K-page 后被注入为 inline wikilink,文本节点被
    // 切开 → 用 reader header 的 path 判定当前已加载哪个 source。
    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    await waitFor(() => expect(within(reader).getByText("sources/architecture.md")).toBeInTheDocument());

    // Switch to a different source while the first /provenance is still pending.
    await userEvent.click(screen.getByRole("button", { name: /Synthesis notes/ }));
    await waitFor(() => expect(within(reader).getByText("sources/synthesis-notes.md")).toBeInTheDocument());

    // Synthesis 在 body "Body of synthesis notes source." 中有字面命中(大小写
    // 不敏感) → 走 inline。inline button 的可见文本是原文 "synthesis",
    // data-wiki-link 才是 title "Synthesis"。
    const readTab = within(reader).getByRole("tabpanel", { name: /Read/ });
    const synthesisInline = await within(readTab).findByRole("button", { name: /^synthesis$/i });
    expect(synthesisInline).toHaveClass("inline-wikilink");
    expect(synthesisInline.getAttribute("data-wiki-link")).toBe("Synthesis");

    // Now resolve the stale architecture provenance — but with a payload
    // whose `path` matches the CURRENT on-screen page so the memo's
    // `derived.path === page?.path` guard would accept it. The only thing
    // stopping Architecture from showing up is the abort-guard inside the
    // effect, which short-circuits on `controller.signal.aborted` before
    // calling setDerived. If the abort-guard were removed, Architecture
    // would leak in. body 中无 "Architecture" 字面 → 不会被 inline。剩下的
    // unlinked refs 也应该为空 → Linked-references panel 不渲染。
    await act(async () => {
      resolveStaleProvenance?.({
        path: "sources/synthesis-notes.md",
        derived_from: [],
        derived_pages: [{ doc_id: "knowledge-architecture", path: "knowledge/architecture.md", title: "Architecture" }]
      });
    });

    expect(within(readTab).queryByRole("button", { name: /^architecture$/i })).not.toBeInTheDocument();
    expect(within(reader).queryByRole("region", { name: "Linked references" })).not.toBeInTheDocument();
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
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    expect(screen.queryByLabelText("Layer")).not.toBeInTheDocument();
    const directory = await screen.findByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "base" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: "knowledge" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: "sources" })).toBeInTheDocument();
    expect(await screen.findByText("Layered DIKW notes.")).toBeInTheDocument();
  });

  it("excludes wisdom pages from the base directory tree", async () => {
    const client = createMockClient();
    const wisdomPage: DocumentRecord = {
      doc_id: "wisdom-first-principles",
      path: "wisdom/elon-musk/first-principles.md",
      path_key: "wisdom/elon-musk/first-principles.md",
      title: "First principles",
      hash: "hash-w",
      mtime: 1777819500,
      layer: "wisdom",
      active: true
    };
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture, wisdomPage]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["knowledge/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    const directory = await screen.findByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "knowledge" })).toBeInTheDocument();
    expect(within(directory).getByRole("treeitem", { name: "sources" })).toBeInTheDocument();
    // wisdom has its own #wisdom page and must not surface in the Base tree.
    expect(within(directory).queryByRole("treeitem", { name: "wisdom" })).not.toBeInTheDocument();
    expect(within(directory).queryByText("First principles")).not.toBeInTheDocument();
  });

  it("filters wisdom pages out of a source page's provenance references", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([...sourcePagesFixture, ...wikiPagesFixture]);
      }
      if (path.endsWith("/links")) {
        const target = decodeURIComponent(path.replace("/v1/base/pages/", "").replace(/\/links$/, ""));
        return Promise.resolve({ path: target, outgoing: [], incoming: [] });
      }
      if (path.endsWith("/provenance")) {
        const target = decodeURIComponent(path.replace("/v1/base/pages/", "").replace(/\/provenance$/, ""));
        // knowledge/synthesis.md is in the page list (resolves to layer knowledge);
        // the wisdom path is NOT, so resolveDerivedPages infers layer "wisdom" via
        // its cache-lag fallback. Base must drop that wisdom ref.
        return Promise.resolve({
          path: target,
          derived_from: [],
          derived_pages: [
            { doc_id: "knowledge-synthesis", path: "knowledge/synthesis.md", title: "Synthesis" },
            { doc_id: "wisdom-lesson", path: "wisdom/lessons/alpha.md", title: "Wisdom Lesson Alpha" }
          ]
        });
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve(wikiPageBodiesFixture[selectedPath] ?? wikiPageBodiesFixture["sources/architecture.md"]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} initialPath="sources/architecture.md" />);

    const reader = await screen.findByRole("main", { name: "Wiki reader" });
    // The knowledge provenance ref renders; the wisdom one is filtered out of Base.
    await waitFor(() => expect(within(reader).getByText("Synthesis")).toBeInTheDocument());
    expect(within(reader).queryByText("Wisdom Lesson Alpha")).not.toBeInTheDocument();
  });

  it("preserves an initial wiki path while the page list is still loading", async () => {
    const client = createMockClient();
    let resolvePages: (pages: DocumentRecord[]) => void = () => undefined;
    const pagesPromise = new Promise<DocumentRecord[]>((resolve) => {
      resolvePages = resolve;
    });
    const bodyReads: string[] = [];

    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return pagesPromise;
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        bodyReads.push(selectedPath);
        return Promise.resolve(wikiPageBodiesFixture[selectedPath]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} initialPath="knowledge/synthesis.md" />);

    resolvePages(wikiPagesFixture);

    expect(await screen.findByText("Synthesis Body.")).toBeInTheDocument();
    expect(screen.queryByText("Layered DIKW notes.")).not.toBeInTheDocument();
    expect(bodyReads).toContain("knowledge/synthesis.md");
    expect(bodyReads).not.toContain("knowledge/architecture.md");
  });

  it("renders wiki pages as a directory tree and opens wikilinks in the preview panel", async () => {
    const client = createMockClient();
    const treePages: DocumentRecord[] = [
      {
        doc_id: "knowledge-dikw-core",
        path: "knowledge/entities/dikw-core.md",
        path_key: "knowledge/entities/dikw-core.md",
        title: "dikw-core",
        hash: "hash-core",
        mtime: 1777820000,
        layer: "knowledge",
        active: true
      },
      {
        doc_id: "knowledge-dikw-pyramid",
        path: "knowledge/concepts/pyramid-diagram.md",
        path_key: "knowledge/concepts/pyramid-diagram.md",
        title: "DIKW 金字塔",
        hash: "hash-pyramid",
        mtime: 1777820100,
        layer: "knowledge",
        active: true
      }
    ];
    const treeBodies: Record<string, PageReadResult> = {
      "knowledge/entities/dikw-core.md": {
        doc_id: "knowledge-dikw-core",
        path: "knowledge/entities/dikw-core.md",
        layer: "knowledge",
        title: "dikw-core",
        body: "# dikw-core\n\nRead about [[DIKW pyramid]].",
        anchors: [{ chunk_id: 301, seq: 1, start: 0, end: 22 }],
        assets: []
      },
      "knowledge/concepts/pyramid-diagram.md": {
        doc_id: "knowledge-dikw-pyramid",
        path: "knowledge/concepts/pyramid-diagram.md",
        layer: "knowledge",
        title: "DIKW 金字塔",
        body: "# DIKW 金字塔\n\nPreview body for the pyramid concept.",
        anchors: [{ chunk_id: 302, seq: 1, start: 0, end: 34 }],
        assets: []
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
    expect(within(directory).getByRole("treeitem", { name: /knowledge/ })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "dikw-core", level: 1 });
    expect(within(directory).getByRole("treeitem", { name: /entities/ })).toBeInTheDocument();
    expect(await within(directory).findByRole("button", { name: /dikw-core/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "dikw-core", level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Wiki link preview" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "DIKW pyramid" }));

    const preview = screen.getByRole("region", { name: "Wiki link preview" });
    expect(within(preview).getByRole("heading", { name: "DIKW 金字塔" })).toBeInTheDocument();
    expect(within(preview).getByText("knowledge/concepts/pyramid-diagram.md")).toBeInTheDocument();
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
            doc_id: "knowledge-dikw-core",
            path: "knowledge/entities/dikw-core.md",
            path_key: "knowledge/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "knowledge",
            active: true
          },
          {
            doc_id: "knowledge-dikw-pyramid",
            path: "knowledge/concepts/dikw-pyramid.md",
            path_key: "knowledge/concepts/dikw-pyramid.md",
            title: "DIKW pyramid",
            hash: "hash-pyramid",
            mtime: 1777820100,
            layer: "knowledge",
            active: true
          }
        ] satisfies DocumentRecord[]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
        return Promise.resolve({
          doc_id: selectedPath,
          path: selectedPath,
          layer: "knowledge",
          title: selectedPath.includes("pyramid") ? "DIKW pyramid" : "dikw-core",
          body: selectedPath.includes("pyramid") ? "# DIKW pyramid\n\nPyramid body." : "# dikw-core\n\nCore body.",
          anchors: [],
          assets: []
        } satisfies PageReadResult);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<WikiPage client={client} />);

    await screen.findByRole("heading", { name: "dikw-core", level: 1 });
    await userEvent.type(screen.getByLabelText("Filter"), "pyramid");

    const directory = screen.getByRole("tree", { name: "Base directory" });
    expect(within(directory).getByRole("treeitem", { name: "knowledge" })).toHaveAttribute("aria-expanded", "true");
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
            doc_id: "knowledge-dikw-core",
            path: "knowledge/entities/dikw-core.md",
            path_key: "knowledge/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "knowledge",
            active: true
          },
          {
            doc_id: "knowledge-dikw-pyramid",
            path: "knowledge/concepts/dikw-pyramid.md",
            path_key: "knowledge/concepts/dikw-pyramid.md",
            title: "DIKW pyramid",
            hash: "hash-pyramid",
            mtime: 1777820100,
            layer: "knowledge",
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
          layer: "knowledge",
          title: selectedPath.includes("pyramid") ? "DIKW pyramid" : "dikw-core",
          body: selectedPath.includes("pyramid") ? "# DIKW pyramid\n\nPyramid body." : "# dikw-core\n\nCore body with [[DIKW pyramid]].",
          anchors: [],
          assets: []
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
    await userEvent.click(screen.getByRole("button", { name: "Refresh base" }));

    expect(bodyReads).toBe(readsAfterClear);
  });

  it("shows an unresolved wikilink preview and can filter by the missing target", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") {
        return Promise.resolve([
          {
            doc_id: "knowledge-dikw-core",
            path: "knowledge/entities/dikw-core.md",
            path_key: "knowledge/entities/dikw-core.md",
            title: "dikw-core",
            hash: "hash-core",
            mtime: 1777820000,
            layer: "knowledge",
            active: true
          }
        ] satisfies DocumentRecord[]);
      }
      if (path.startsWith("/v1/base/pages/")) {
        return Promise.resolve({
          doc_id: "knowledge-dikw-core",
          path: "knowledge/entities/dikw-core.md",
          layer: "knowledge",
          title: "dikw-core",
          body: "# dikw-core\n\nSee [[Missing Concept]].",
          anchors: [],
          assets: []
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
    await userEvent.click(screen.getByRole("button", { name: "Refresh base" }));

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
          frontmatter: { title: "Architecture", tags: ["DIKW"], sources: ["source/a.md"], status: "draft" },
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

    expect(within(reader).getAllByText("knowledge/architecture.md").length).toBeGreaterThan(0);
    expect(within(reader).getByText("draft")).toBeInTheDocument();
    expect(within(reader).getByText("#DIKW")).toBeInTheDocument();
    expect(within(reader).getByText("source/a.md")).toBeInTheDocument();

    await userEvent.click(within(reader).getByRole("tab", { name: "Outline" }));

    expect(within(reader).getByRole("button", { name: "Architecture" })).toBeInTheDocument();
    expect(within(reader).getByRole("button", { name: "Data flow" })).toBeInTheDocument();
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
    window.location.hash = "#base";
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

      expect(window.location.hash).toBe("#base");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("heading", { name: "Architecture", level: 1 })).toBeInTheDocument();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("loads the complete core graph without scope or force controls", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
      if (path === "/v1/base/graph") {
        expect(options?.params).toEqual({ active: true });
        return Promise.resolve(graphResultFixture);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<GraphPage client={client} />);

    expect(await screen.findByText("4 nodes")).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
    expect(screen.getByText("2 unresolved")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Base graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Architecture graph node" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Architecture source graph node" })).toBeInTheDocument();
    expect(document.querySelector(".graph-layout")).toHaveAttribute("data-has-detail", "false");
    expect(screen.queryByRole("button", { name: "Wiki" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repel strength")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Link distance")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Node size")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Link thickness")).not.toBeInTheDocument();

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).not.toHaveBeenCalledWith("/v1/base/pages", expect.anything());
  });

  it("shows graph endpoint loading and error states", async () => {
    const client = createMockClient();
    client.get.mockReturnValue(new Promise(() => undefined));

    render(<GraphPage client={client} />);

    expect(await screen.findByText("Loading graph")).toBeInTheDocument();
    expect(screen.queryByText(/Reading \d+ \/ \d+ pages/)).not.toBeInTheDocument();
  });

  it("shows graph endpoint failures", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(new Error("graph unavailable"));

    render(<GraphPage client={client} />);

    expect(await screen.findByText("Could not build graph")).toBeInTheDocument();
    expect(screen.getByText("graph unavailable")).toBeInTheDocument();
  });

  it("filters graph nodes, focuses neighbors, and opens the selected node in wiki", async () => {
    const client = createMockClient();
    const openedPaths: string[] = [];
    client.get.mockImplementation((path: string) => {
      if (path === "/v1/base/graph") {
        return Promise.resolve(graphResultFixture);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });

    render(<GraphPage client={client} onOpenWikiPath={(path) => openedPaths.push(path)} />);

    expect(await screen.findByText("4 nodes")).toBeInTheDocument();
    expect(screen.getByText("2 unresolved")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Graph search"), "synth");

    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Architecture graph node" })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Graph search"));
    await userEvent.click(screen.getByLabelText("Hide orphans"));

    expect(screen.queryByRole("button", { name: "Orphan graph node" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Architecture graph node" }));

    const detail = screen.getByRole("region", { name: "Graph node detail" });
    expect(document.querySelector(".graph-layout")).toHaveAttribute("data-has-detail", "true");
    expect(within(detail).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(within(detail).getByText("0 inbound")).toBeInTheDocument();
    expect(within(detail).getByText("1 outbound")).toBeInTheDocument();
    expect(within(detail).getByText("Missing Concept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Architecture graph node" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Synthesis graph node" })).toHaveAttribute("data-muted", "false");

    await userEvent.click(within(detail).getByRole("button", { name: "Open in Base" }));

    expect(openedPaths).toEqual(["knowledge/architecture.md"]);
  });

  it("Refresh button clears focus and refetches; no separate Reset focus button", async () => {
    const client = createMockClient();
    client.get.mockImplementation((path: string) =>
      path === "/v1/base/graph"
        ? Promise.resolve(graphResultFixture)
        : Promise.reject(new Error(`Unexpected path ${path}`))
    );

    render(<GraphPage client={client} />);

    expect(await screen.findByText("4 nodes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset focus" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Architecture graph node" }));
    expect(screen.getByRole("region", { name: "Graph node detail" })).toBeInTheDocument();
    // Reset focus must not appear in the toolbar even when a node is focused.
    expect(screen.queryByRole("button", { name: "Reset focus" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Refresh graph" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Graph node detail" })).not.toBeInTheDocument();
    });
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  // WisdomPage is now a hardcoded mock — its interactions are exercised in
  // src/pages/wisdom.test.tsx. The legacy /v1/wisdom contract is no longer
  // called, so the two previous tests here have moved.

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
          { id: "m1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z" },
          {
            id: "m2",
            role: "assistant",
            content: "## Layered answer\n\nUse **evidence**.",
            createdAt: "2026-05-13T00:00:01.000Z"
          }
        ],
        toolEvents: [
          {
            id: "tool-1",
            type: "tool_call",
            name: "retrieve_knowledge",
            status: "succeeded",
            createdAt: "2026-05-13T00:00:00.500Z"
          }
        ],
        sources: [{ path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" }],
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
              createdAt: "2026-05-13T00:00:00.500Z"
            }
          },
          {
            type: "source",
            sessionId: "session-1",
            source: { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" }
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
    expect(screen.getByText("knowledge/architecture.md")).toBeInTheDocument();
    expect(agentClient.sendMessage).toHaveBeenCalledWith("session-1", "What is DIKW?", expect.any(AbortSignal));
  });

  it("uses chat terminology and renames sessions from the session menu", async () => {
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
      createSession: vi.fn().mockResolvedValue({
        ...activeSession,
        id: "session-2",
        title: "New chat"
      }),
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

    await userEvent.click(await screen.findByRole("button", { name: "New chat options" }));
    const menu = screen.getByRole("menu", { name: "New chat menu" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Rename chat" }));
    await userEvent.clear(screen.getByLabelText("Chat title"));
    await userEvent.type(screen.getByLabelText("Chat title"), "Project Review");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));

    await waitFor(() => {
      expect(agentClient.renameSession).toHaveBeenCalledWith("session-1", "Project Review");
      expect(within(screen.getByRole("complementary", { name: "Chat history" })).getByText("Project Review", { selector: "strong" })).toBeInTheDocument();
    });
  });

  it("deletes chat sessions from the session menu", async () => {
    const activeSession = {
      id: "session-1",
      title: "Project Review",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      messageCount: 0,
      lastMessagePreview: "",
      messages: [],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue({
        ...activeSession,
        id: "session-2",
        title: "New chat"
      }),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      sendMessage: vi.fn(() => createAsyncEvents([] satisfies AgentStreamEvent[]))
    } as AgentClientLike & { deleteSession: ReturnType<typeof vi.fn> };

    render(<ChatPage agentClient={agentClient} />);

    await userEvent.click(await screen.findByRole("button", { name: "Project Review options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete chat" }));

    await waitFor(() => {
      expect(agentClient.deleteSession).toHaveBeenCalledWith("session-1");
      expect(screen.queryByText("Project Review", { selector: "strong" })).not.toBeInTheDocument();
    });
  });

  it("shows chat sources and tool calls as session context", async () => {
    const activeSession = {
      id: "session-1",
      title: "Session context",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:04.000Z",
      messageCount: 4,
      lastMessagePreview: "Second answer",
      messages: [
        { id: "u1", role: "user", content: "First question", createdAt: "2026-05-13T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "First answer", createdAt: "2026-05-13T00:00:01.000Z" },
        { id: "u2", role: "user", content: "Second question", createdAt: "2026-05-13T00:00:03.000Z" },
        { id: "a2", role: "assistant", content: "Second answer", createdAt: "2026-05-13T00:00:04.000Z" }
      ],
      toolEvents: [
        {
          id: "tool-1",
          type: "tool_call" as const,
          name: "read_page",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z"
        },
        {
          id: "tool-2",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:03.500Z"
        }
      ],
      sources: [
        { path: "knowledge/first.md", title: "First", layer: "knowledge" },
        { path: "knowledge/second.md", title: "Second", layer: "knowledge" }
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
    const context = screen.getByRole("complementary", { name: "Session context" });
    expect(within(context).getByText("knowledge/first.md")).toBeInTheDocument();
    expect(within(context).getByText("knowledge/second.md")).toBeInTheDocument();
    expect(within(context).getByText("read_page")).toBeInTheDocument();
    expect(within(context).getByText("retrieve_knowledge")).toBeInTheDocument();
  });

  it("renders web kind sources as external links with a Web badge", async () => {
    const activeSession = {
      id: "session-1",
      title: "Web search",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 2,
      lastMessagePreview: "Web answer",
      messages: [
        { id: "u1", role: "user", content: "search the web", createdAt: "2026-05-13T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "Web answer", createdAt: "2026-05-13T00:00:01.000Z" }
      ],
      toolEvents: [],
      sources: [
        { path: "https://example.com/a", title: "Example A", excerpt: "external snippet", kind: "web" as const },
        { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" }
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

    const context = await screen.findByRole("complementary", { name: "Session context" });
    const link = within(context).getByRole("link", { name: /example\.com\/a/ });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toMatch(/noopener/);
    expect(within(context).getByText("Web")).toBeInTheDocument();
    expect(within(context).getByText("external snippet")).toBeInTheDocument();

    expect(within(context).getByText("knowledge/architecture.md")).toBeInTheDocument();
    expect(within(context).getByText("knowledge")).toBeInTheDocument();
  });

  it("refuses to render a web source whose stored path is unsafe", async () => {
    const activeSession = {
      id: "session-1",
      title: "Bad URLs",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 0,
      lastMessagePreview: "",
      messages: [],
      toolEvents: [],
      sources: [
        { path: "javascript:alert(1)", title: "xss", kind: "web" as const },
        { path: "http://localhost/admin", title: "internal", kind: "web" as const },
        { path: "https://example.com/ok", title: "good", kind: "web" as const }
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

    const context = await screen.findByRole("complementary", { name: "Session context" });
    expect(within(context).queryByRole("link", { name: /javascript:/ })).toBeNull();
    expect(within(context).queryByRole("link", { name: /localhost/ })).toBeNull();
    expect(within(context).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(within(context).getByText("http://localhost/admin")).toBeInTheDocument();
    const safeLink = within(context).getByRole("link", { name: /example\.com\/ok/ });
    expect(safeLink).toHaveAttribute("href", "https://example.com/ok");
  });

  it("dedups a streaming source that already exists on the active session", async () => {
    // Reproduces the dup-key React warning observed in the auto-scroll stress
    // e2e: turn 2's streaming emits the same wiki page that turn 1 already
    // committed to session.sources. Without cross-boundary dedup the right-
    // rail concatenates both buffers and produces identical React keys.
    //
    // A controlled stream pauses between the `source` event and the end of
    // the stream so the intermediate render (both buffers populated) is
    // observable; an inline `createAsyncEvents` array would race React to
    // the final cleared-streaming state and hide the bug.
    const sharedSource = { path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" };
    const activeSession = {
      id: "session-1",
      title: "Dedup",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 2,
      lastMessagePreview: "First answer",
      messages: [
        { id: "u1", role: "user", content: "First question", createdAt: "2026-05-13T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "First answer", createdAt: "2026-05-13T00:00:01.000Z" }
      ],
      toolEvents: [],
      sources: [sharedSource],
      proposals: []
    };
    const controlledStream = createControlledAgentStream();
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => controlledStream.stream())
    } as AgentClientLike;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<ChatPage agentClient={agentClient} />);
      const context = await screen.findByRole("complementary", { name: "Session context" });
      // Turn 1 already committed sharedSource — confirm starting state.
      expect(within(context).getAllByText("knowledge/architecture.md")).toHaveLength(1);

      await userEvent.type(screen.getByLabelText("Message"), "Second question");
      await userEvent.click(screen.getByRole("button", { name: /Send/ }));

      controlledStream.push({
        type: "source",
        sessionId: "session-1",
        source: sharedSource
      });

      // While the stream is still open, the cross-boundary dedup gap must
      // not allow a duplicate entry to render.
      await waitFor(() => {
        const matches = within(context).getAllByText("knowledge/architecture.md");
        expect(matches).toHaveLength(1);
      });

      const dupKeyCalls = errorSpy.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === "string" && arg.includes("two children with the same key"))
      );
      expect(dupKeyCalls).toEqual([]);

      controlledStream.finish();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps session sources and tool calls visible after a later reply without new context", async () => {
    const initialSession = {
      id: "session-1",
      title: "Health check",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:02.000Z",
      messageCount: 2,
      lastMessagePreview: "Layered answer.",
      messages: [
        { id: "u1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "Layered answer.", createdAt: "2026-05-13T00:00:01.000Z" }
      ],
      toolEvents: [
        {
          id: "tool-1",
          type: "tool_call" as const,
          name: "retrieve_knowledge",
          status: "succeeded" as const,
          createdAt: "2026-05-13T00:00:00.500Z"
        }
      ],
      sources: [{ path: "knowledge/architecture.md", title: "Architecture", layer: "knowledge" }],
      proposals: []
    };
    const refreshedSession = {
      ...initialSession,
      updatedAt: "2026-05-13T00:00:04.000Z",
      messageCount: 4,
      lastMessagePreview: "Health failed.",
      messages: [
        ...initialSession.messages,
        { id: "u2", role: "user", content: "Check health", createdAt: "2026-05-13T00:00:03.000Z" },
        { id: "a2", role: "assistant", content: "Health failed.", createdAt: "2026-05-13T00:00:04.000Z" }
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
    expect(await screen.findByText("knowledge/architecture.md")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message"), "Check health");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    const context = screen.getByRole("complementary", { name: "Session context" });
    await waitFor(() => expect(screen.getAllByText("Health failed.").length).toBeGreaterThan(0));
    expect(within(context).getByText("knowledge/architecture.md")).toBeInTheDocument();
    expect(within(context).getByText("retrieve_knowledge")).toBeInTheDocument();
  });

  it("keeps session context outside the conversation scroll region while the composer stays fixed outside it", async () => {
    const activeSession = {
      id: "session-1",
      title: "Layout",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 2,
      lastMessagePreview: "Answer",
      messages: [
        { id: "u1", role: "user", content: "Question", createdAt: "2026-05-13T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "Answer", createdAt: "2026-05-13T00:00:01.000Z" }
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
    const context = screen.getByRole("complementary", { name: "Session context" });
    expect(scrollRegion).not.toContainElement(context);
    expect(within(context).getByText("Sources")).toBeInTheDocument();
    expect(within(context).getByText("Tool calls")).toBeInTheDocument();
    expect(scrollRegion).not.toContainElement(screen.getByLabelText("Message"));
    expect(scrollRegion).not.toContainElement(screen.getByRole("button", { name: /Send/ }));
  });

  it("keeps a user-scrolled conversation panel in place during streaming updates", async () => {
    const activeSession = {
      id: "session-1",
      title: "Sticky scroll",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: 0,
      lastMessagePreview: "",
      messages: [],
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const controlledStream = createControlledAgentStream();
    const agentClient = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValue(activeSession),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() => controlledStream.stream())
    } as AgentClientLike;

    render(<ChatPage agentClient={agentClient} />);

    const scrollRegion = await screen.findByTestId("agent-conversation-scroll");
    Object.defineProperties(scrollRegion, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 }
    });

    await userEvent.type(screen.getByLabelText("Message"), "Stream slowly");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(scrollRegion.scrollTop).toBe(1000));

    scrollRegion.scrollTop = 0;
    fireEvent.scroll(scrollRegion);

    controlledStream.push({ type: "message_delta", sessionId: "session-1", delta: "First streamed chunk." });
    expect(await screen.findByText("First streamed chunk.")).toBeInTheDocument();
    expect(scrollRegion.scrollTop).toBe(0);

    scrollRegion.scrollTop = 1000;
    fireEvent.scroll(scrollRegion);
    controlledStream.push({ type: "message_delta", sessionId: "session-1", delta: " Second streamed chunk." });
    await waitFor(() => expect(scrollRegion.scrollTop).toBe(1000));

    controlledStream.finish();
  });

  it("surfaces the error message when the agent stream emits an error event", async () => {
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
    const refreshed = {
      ...activeSession,
      messages: [{ id: "m1", role: "user" as const, content: "ping", createdAt: "2026-05-13T00:00:00.500Z" }]
    };
    const agentClient: AgentClientLike = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValueOnce(activeSession).mockResolvedValue(refreshed),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() =>
        createAsyncEvents([
          { type: "agent_start", sessionId: "session-1" },
          {
            type: "error",
            sessionId: "session-1",
            code: "agent_error",
            message: "Codex refresh token was already consumed"
          },
          { type: "agent_end", sessionId: "session-1" }
        ] satisfies AgentStreamEvent[])
      )
    };

    render(<ChatPage agentClient={agentClient} />);
    await userEvent.type(await screen.findByLabelText("Message"), "ping");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    expect(await screen.findByText("Agent failed")).toBeInTheDocument();
    expect(await screen.findByText(/Codex refresh token was already consumed/)).toBeInTheDocument();
  });

  it("warns when the agent stream ends without any assistant response", async () => {
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
    const refreshed = {
      ...activeSession,
      messages: [{ id: "m1", role: "user" as const, content: "ping", createdAt: "2026-05-13T00:00:00.500Z" }]
    };
    const agentClient: AgentClientLike = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValueOnce(activeSession).mockResolvedValue(refreshed),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() =>
        createAsyncEvents([
          { type: "agent_start", sessionId: "session-1" },
          { type: "agent_end", sessionId: "session-1" }
        ] satisfies AgentStreamEvent[])
      )
    };

    render(<ChatPage agentClient={agentClient} />);
    await userEvent.type(await screen.findByLabelText("Message"), "ping");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    expect(await screen.findByText("Agent failed")).toBeInTheDocument();
    expect(await screen.findByText(/no response/i)).toBeInTheDocument();
  });

  it("warns when a follow-up turn silently ends even though the chat already has prior assistant replies", async () => {
    const priorMessages = [
      { id: "m1", role: "user" as const, content: "first", createdAt: "2026-05-13T00:00:00.000Z" },
      { id: "m2", role: "assistant" as const, content: "old answer", createdAt: "2026-05-13T00:00:01.000Z" }
    ];
    const activeSession = {
      id: "session-1",
      title: "Existing chat",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:01.000Z",
      messageCount: priorMessages.length,
      lastMessagePreview: "old answer",
      messages: priorMessages,
      toolEvents: [],
      sources: [],
      proposals: []
    };
    const refreshed = {
      ...activeSession,
      messages: [
        ...priorMessages,
        { id: "m3", role: "user" as const, content: "follow-up", createdAt: "2026-05-13T00:00:02.000Z" }
      ]
    };
    const agentClient: AgentClientLike = {
      listSessions: vi.fn().mockResolvedValue([activeSession]),
      createSession: vi.fn().mockResolvedValue(activeSession),
      getSession: vi.fn().mockResolvedValueOnce(activeSession).mockResolvedValue(refreshed),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      abort: vi.fn(),
      sendMessage: vi.fn(() =>
        createAsyncEvents([
          { type: "agent_start", sessionId: "session-1" },
          { type: "agent_end", sessionId: "session-1" }
        ] satisfies AgentStreamEvent[])
      )
    };

    render(<ChatPage agentClient={agentClient} />);
    await userEvent.type(await screen.findByLabelText("Message"), "follow-up");
    await userEvent.click(screen.getByRole("button", { name: /Send/ }));

    expect(await screen.findByText("Agent failed")).toBeInTheDocument();
    expect(await screen.findByText(/no response/i)).toBeInTheDocument();
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
    client.listTasks.mockResolvedValue(taskListPageFixture);
    client.getTask.mockResolvedValue(taskRowsFixture[0]);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(taskEventsFixture));

    render(<TasksPage client={client} />);

    const detail = await screen.findByRole("heading", { name: "eval" });
    expect(detail).toBeInTheDocument();
    expect(await screen.findByText("synthetic-diverse-v1")).toBeInTheDocument();

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
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(ingestRows[0])]));
    client.getTask.mockResolvedValue(ingestRows[0]);
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(ingestFileErrorEventsFixture));

    render(<TasksPage client={client} />);

    expect(await screen.findByRole("heading", { name: "ingest" })).toBeInTheDocument();
    expect(await screen.findByText("1 file error")).toBeInTheDocument();

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
    client.listTasks.mockResolvedValue(taskListPageFixture);
    client.getTask.mockResolvedValue(taskRowsFixture[0]);
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
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(runningTask)]));
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
    client.listTasks.mockResolvedValue(taskListPageFixture);
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
    client.listTasks.mockResolvedValue(toTaskListPage(mixedRows.map(toTaskSummary)));
    client.getTask.mockImplementation((id: string) => Promise.resolve(mixedRows.find((row) => row.task_id === id)));
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

  it("Load more 按钮文案随 locale 本地化", async () => {
    const client = createMockClient();
    client.listTasks.mockResolvedValue(
      toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    const { unmount } = render(<TasksPage client={client} locale="zh-CN" />);
    await screen.findByText("bulk-task-01");
    expect(screen.getByRole("button", { name: "加载更多" })).toBeInTheDocument();
    unmount();

    render(<TasksPage client={client} locale="en" />);
    await screen.findByText("bulk-task-01");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("首屏渲染服务端首页，has_more 时显示 Load more", async () => {
    const client = createMockClient();
    client.listTasks.mockResolvedValue(
      toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);

    await screen.findByText("bulk-task-01");
    expect(screen.getByText("bulk-task-20")).toBeInTheDocument();
    expect(screen.queryByText("bulk-task-21")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("点击 Load more 带上 next_cursor 追加下一页；到底后按钮消失", async () => {
    const client = createMockClient();
    client.listTasks
      .mockResolvedValueOnce(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
      )
      .mockResolvedValueOnce(toTaskListPage(manyTaskSummariesFixture.slice(20), { hasMore: false }));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    const listPanel = (await screen.findByText("bulk-task-01")).closest(".panel.task-list-panel") as HTMLElement;
    expect(within(listPanel).queryByText("bulk-task-21")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(within(listPanel).getByText("bulk-task-21")).toBeInTheDocument();
    });
    expect(within(listPanel).getByText("bulk-task-25")).toBeInTheDocument();
    expect(within(listPanel).getByText("bulk-task-01")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
    expect(client.listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2" }));
  });

  it("更改 Op 过滤后重新拉取首页（带 op、不带 cursor）", async () => {
    const client = createMockClient();
    client.listTasks.mockImplementation((params: { op?: string; cursor?: string }) => {
      const tasks = params.op ? manyTaskSummariesFixture.slice(0, 3) : manyTaskSummariesFixture.slice(0, 20);
      return Promise.resolve(toTaskListPage(tasks, { hasMore: !params.op, nextCursor: params.op ? null : "cursor-2" }));
    });
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    const listPanel = (await screen.findByText("bulk-task-01")).closest(".panel.task-list-panel") as HTMLElement;
    expect(within(listPanel).getByText("bulk-task-20")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Op/), "ingest");

    await waitFor(() => {
      expect(within(listPanel).queryByText("bulk-task-20")).not.toBeInTheDocument();
    });
    expect(within(listPanel).getByText("bulk-task-03")).toBeInTheDocument();
    expect(within(listPanel).queryByText("bulk-task-04")).not.toBeInTheDocument();

    const lastArgs = client.listTasks.mock.calls.at(-1)?.[0] as { op?: string; cursor?: string };
    expect(lastArgs.op).toBe("ingest");
    expect(lastArgs.cursor).toBeUndefined();
  });

  it("refresh 后选中任务消失时自动改选首项", async () => {
    const initial = manyTaskSummariesFixture.slice(0, 5); // bulk-task-01..05
    const reloaded = manyTaskSummariesFixture.slice(5, 10); // bulk-task-06..10
    let callCount = 0;
    const client = createMockClient();
    client.listTasks.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(toTaskListPage(callCount === 1 ? initial : reloaded));
    });
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByText("bulk-task-03").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector(".reader-header__path")?.textContent).toBe("bulk-task-03");
    });

    await userEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() => {
      expect(document.querySelector(".reader-header__path")?.textContent).toBe("bulk-task-06");
    });
    expect(screen.queryByText("bulk-task-03")).not.toBeInTheDocument();
  });

  it("筛选变化后详情面板同步切到新首项", async () => {
    const client = createMockClient();
    const narrow = [
      toTaskSummary({ ...manyTaskRowsFixture[0], task_id: "narrow-task-A", status: "succeeded" }),
      toTaskSummary({ ...manyTaskRowsFixture[1], task_id: "narrow-task-B", status: "succeeded" })
    ];
    client.listTasks.mockImplementation((params: { status?: string }) =>
      Promise.resolve(toTaskListPage(params.status ? narrow : manyTaskSummariesFixture.slice(0, 20)))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.selectOptions(screen.getByLabelText(/Status/), "succeeded");
    await waitFor(() => {
      expect(document.querySelector(".reader-header__path")?.textContent).toBe("narrow-task-A");
    });
    expect(screen.queryByText("bulk-task-01")).not.toBeInTheDocument();
  });

  it("Load more 追加后保持当前选中项", async () => {
    const client = createMockClient();
    client.listTasks
      .mockResolvedValueOnce(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
      )
      .mockResolvedValueOnce(toTaskListPage(manyTaskSummariesFixture.slice(20), { hasMore: false }));
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");
    await userEvent.click(screen.getByText("bulk-task-05").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector(".reader-header__path")?.textContent).toBe("bulk-task-05");
    });

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("bulk-task-25");

    expect(document.querySelector(".reader-header__path")?.textContent).toBe("bulk-task-05");
  });

  it("Load more 命中 invalid_cursor 时回落到首页", async () => {
    const client = createMockClient();
    client.listTasks
      .mockResolvedValueOnce(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "stale", hasMore: true })
      )
      .mockRejectedValueOnce(new DikwClientError({ status: 400, code: "invalid_cursor", message: "invalid cursor" }))
      .mockResolvedValueOnce(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
      );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(client.listTasks).toHaveBeenCalledTimes(3);
    });
    const lastArgs = client.listTasks.mock.calls.at(-1)?.[0] as { cursor?: string };
    expect(lastArgs.cursor).toBeUndefined();
    expect(screen.getAllByText("bulk-task-01").length).toBeGreaterThan(0);
    expect(screen.queryByText("Could not read task list")).not.toBeInTheDocument();
  });

  it("Load more 失败后重试成功时清除错误提示", async () => {
    const client = createMockClient();
    client.listTasks
      .mockResolvedValueOnce(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
      )
      .mockRejectedValueOnce(new DikwClientError({ status: 500, code: "internal", message: "boom" }))
      .mockResolvedValueOnce(toTaskListPage(manyTaskSummariesFixture.slice(20), { hasMore: false }));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Could not read task list")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("bulk-task-25");
    expect(screen.queryByText("Could not read task list")).not.toBeInTheDocument();
  });

  it("Load more 进行中切换筛选时丢弃过期追加结果", async () => {
    const client = createMockClient();
    let resolveStale: (() => void) | null = null;
    client.listTasks.mockImplementation((params: { status?: string; cursor?: string }) => {
      if (params.cursor) {
        return new Promise<TaskListPage>((resolve) => {
          resolveStale = () => resolve(toTaskListPage(manyTaskSummariesFixture.slice(20), { hasMore: false }));
        });
      }
      if (params.status) {
        return Promise.resolve(
          toTaskListPage([toTaskSummary({ ...manyTaskRowsFixture[0], task_id: "filtered-1", status: "succeeded" })])
        );
      }
      return Promise.resolve(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
      );
    });
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(resolveStale).not.toBeNull());

    await userEvent.selectOptions(screen.getByLabelText(/Status/), "succeeded");
    await screen.findAllByText("filtered-1");

    await act(async () => {
      resolveStale?.();
      await Promise.resolve();
    });

    expect(screen.queryByText("bulk-task-21")).not.toBeInTheDocument();
    expect(screen.getAllByText("filtered-1").length).toBeGreaterThan(0);
  });

  it("Refresh 首页请求进行中切换筛选时丢弃过期结果", async () => {
    const client = createMockClient();
    let initialDone = false;
    let resolveStaleRefresh: (() => void) | null = null;
    client.listTasks.mockImplementation((params: { status?: string; cursor?: string }) => {
      if (params.status === "succeeded") {
        return Promise.resolve(
          toTaskListPage([toTaskSummary({ ...manyTaskRowsFixture[0], task_id: "filtered-1", status: "succeeded" })])
        );
      }
      if (!initialDone) {
        initialDone = true;
        return Promise.resolve(toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { hasMore: false }));
      }
      // The signal-less Refresh request: held open until after the filter switch.
      return new Promise<TaskListPage>((resolve) => {
        resolveStaleRefresh = () =>
          resolve(toTaskListPage([toTaskSummary({ ...manyTaskRowsFixture[0], task_id: "stale-refresh" })]));
      });
    });
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() => expect(resolveStaleRefresh).not.toBeNull());

    await userEvent.selectOptions(screen.getByLabelText(/Status/), "succeeded");
    await screen.findAllByText("filtered-1");

    await act(async () => {
      resolveStaleRefresh?.();
      await Promise.resolve();
    });

    expect(screen.queryByText("stale-refresh")).not.toBeInTheDocument();
    expect(screen.getAllByText("filtered-1").length).toBeGreaterThan(0);
  });

  it("Load more 进行中点击 Refresh 时丢弃过期追加页", async () => {
    const client = createMockClient();
    let resolveStaleMore: (() => void) | null = null;
    let initialDone = false;
    client.listTasks.mockImplementation((params: { status?: string; cursor?: string }) => {
      if (params.cursor) {
        // The in-flight Load more — held open until after Refresh resets the list.
        return new Promise<TaskListPage>((resolve) => {
          resolveStaleMore = () => resolve(toTaskListPage(manyTaskSummariesFixture.slice(20), { hasMore: false }));
        });
      }
      if (!initialDone) {
        initialDone = true;
        return Promise.resolve(
          toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-2", hasMore: true })
        );
      }
      // Refresh response: a fresh first page with a new cursor.
      return Promise.resolve(
        toTaskListPage(manyTaskSummariesFixture.slice(0, 20), { nextCursor: "cursor-fresh", hasMore: true })
      );
    });
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents([]));

    render(<TasksPage client={client} />);
    await screen.findByText("bulk-task-01");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(resolveStaleMore).not.toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() => expect(client.listTasks).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveStaleMore?.();
      await Promise.resolve();
    });

    // The stale Load-more page (bulk-task-21+) must not be appended after Refresh.
    expect(screen.queryByText("bulk-task-21")).not.toBeInTheDocument();
    expect(screen.getAllByText("bulk-task-01").length).toBeGreaterThan(0);
  });

  it("事件区：终止态任务 Load 25 个事件后默认在第 1 页，aria-label 与分页指示器到位", async () => {
    const client = createMockClient();
    const events = manyTaskEventsFixture(25);
    const terminalRow: TaskRow = {
      task_id: "bulk-events-1",
      op: "ingest",
      status: "succeeded",
      created_at: "2026-05-17T10:00:00Z",
      started_at: "2026-05-17T10:00:00Z",
      finished_at: "2026-05-17T10:01:00Z",
      params_digest: "evt",
      result: null,
      error: null
    };
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(terminalRow)]));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(events));

    render(<TasksPage client={client} />);

    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));

    expect(await screen.findByText("25 events")).toBeInTheDocument();

    const tape = screen.getByText("Event tape").closest("section") as HTMLElement;
    expect(within(tape).getByText("#1")).toBeInTheDocument();
    expect(within(tape).queryByText("#21")).not.toBeInTheDocument();
    expect(within(tape).getByText(/Page\s*1\s*\/\s*2/i)).toBeInTheDocument();
    expect(within(tape).getByRole("navigation", { name: "event pagination" })).toBeInTheDocument();
  });

  it("事件区：终止态任务点 Next 渲染 21-25 + final；首尾页按钮禁用", async () => {
    const client = createMockClient();
    const events = manyTaskEventsFixture(25);
    const terminalRow: TaskRow = {
      task_id: "bulk-events-1",
      op: "ingest",
      status: "succeeded",
      created_at: "2026-05-17T10:00:00Z",
      started_at: "2026-05-17T10:00:00Z",
      finished_at: "2026-05-17T10:01:00Z",
      params_digest: "evt",
      result: null,
      error: null
    };
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(terminalRow)]));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(events));

    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));
    await screen.findByText("25 events");

    const tape = screen.getByText("Event tape").closest("section") as HTMLElement;
    expect(within(tape).getByRole("button", { name: /Prev/i })).toBeDisabled();
    expect(within(tape).getByRole("button", { name: /Next/i })).toBeEnabled();

    await userEvent.click(within(tape).getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(within(tape).getByText("#21")).toBeInTheDocument();
    });
    expect(within(tape).getByText("#25")).toBeInTheDocument();
    expect(within(tape).queryByText("#1")).not.toBeInTheDocument();
    expect(within(tape).queryByText("#20")).not.toBeInTheDocument();
    expect(within(tape).getByText(/Page\s*2\s*\/\s*2/i)).toBeInTheDocument();
    expect(within(tape).getByRole("button", { name: /Next/i })).toBeDisabled();

    await userEvent.click(within(tape).getByRole("button", { name: /Prev/i }));
    await waitFor(() => {
      expect(within(tape).getByText("#1")).toBeInTheDocument();
    });
    expect(within(tape).queryByText("#21")).not.toBeInTheDocument();
    expect(within(tape).getByRole("button", { name: /Prev/i })).toBeDisabled();
  });

  it("事件区：Follow 运行中任务默认贴尾，事件越过页边界后自动跳到末页", async () => {
    const client = createMockClient();
    const runningRow: TaskRow = {
      task_id: "bulk-events-2",
      op: "ingest",
      status: "running",
      created_at: "2026-05-17T10:00:00Z",
      started_at: "2026-05-17T10:00:00Z",
      finished_at: null,
      params_digest: "evt",
      result: null,
      error: null
    };
    const controlled = createControlledTaskEventStream();
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(runningRow)]));
    client.streamTaskEvents.mockImplementation(() => controlled.stream());

    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Follow$/ }));

    // 推 5 个事件 -> 仍是 1 页
    for (let seq = 1; seq <= 5; seq += 1) {
      controlled.push(makeProgressEvent(seq, 30));
    }
    expect(await screen.findByText("5 events")).toBeInTheDocument();
    const tape = screen.getByText("Event tape").closest("section") as HTMLElement;
    // pageCount=1, PaginationBar 不渲染
    expect(within(tape).queryByRole("navigation", { name: "event pagination" })).not.toBeInTheDocument();
    expect(within(tape).getByText("#5")).toBeInTheDocument();

    // 推到 21 个事件 -> pageCount=2，stick=true 应自动跳到第 2 页
    for (let seq = 6; seq <= 21; seq += 1) {
      controlled.push(makeProgressEvent(seq, 30));
    }
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*2\s*\/\s*2/i)).toBeInTheDocument();
    });
    expect(within(tape).getByText("#21")).toBeInTheDocument();
    expect(within(tape).queryByText("#1")).not.toBeInTheDocument();

    controlled.finish();
  });

  it("事件区：Follow 中点 Prev 后断开贴尾；翻回末页恢复贴尾", async () => {
    const client = createMockClient();
    const runningRow: TaskRow = {
      task_id: "bulk-events-3",
      op: "ingest",
      status: "running",
      created_at: "2026-05-17T10:00:00Z",
      started_at: "2026-05-17T10:00:00Z",
      finished_at: null,
      params_digest: "evt",
      result: null,
      error: null
    };
    const controlled = createControlledTaskEventStream();
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(runningRow)]));
    client.streamTaskEvents.mockImplementation(() => controlled.stream());

    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Follow$/ }));

    // 推 21 个 -> Page 2/2
    for (let seq = 1; seq <= 21; seq += 1) {
      controlled.push(makeProgressEvent(seq, 80));
    }
    expect(await screen.findByText("21 events")).toBeInTheDocument();
    const tape = screen.getByText("Event tape").closest("section") as HTMLElement;
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*2\s*\/\s*2/i)).toBeInTheDocument();
    });

    // 点 Prev 回到 Page 1/2 -> 断开 stick
    await userEvent.click(within(tape).getByRole("button", { name: /Prev/i }));
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*1\s*\/\s*2/i)).toBeInTheDocument();
    });

    // 继续推到 41 个 -> pageCount=3，stick 已断 -> 仍在 Page 1/3
    for (let seq = 22; seq <= 41; seq += 1) {
      controlled.push(makeProgressEvent(seq, 80));
    }
    expect(await screen.findByText("41 events")).toBeInTheDocument();
    expect(within(tape).getByText(/Page\s*1\s*\/\s*3/i)).toBeInTheDocument();
    expect(within(tape).getByText("#1")).toBeInTheDocument();
    expect(within(tape).queryByText("#41")).not.toBeInTheDocument();

    // 点 Next 两次回到末页 Page 3/3 -> 恢复 stick
    await userEvent.click(within(tape).getByRole("button", { name: /Next/i }));
    await userEvent.click(within(tape).getByRole("button", { name: /Next/i }));
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*3\s*\/\s*3/i)).toBeInTheDocument();
    });

    // 再推 1 个事件越过页边界 -> pageCount=3 不变（41+1=42 仍 3 页）；推到 61 个让 pageCount=4
    for (let seq = 42; seq <= 61; seq += 1) {
      controlled.push(makeProgressEvent(seq, 80));
    }
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*4\s*\/\s*4/i)).toBeInTheDocument();
    });
    expect(within(tape).getByText("#61")).toBeInTheDocument();

    controlled.finish();
  });

  it("事件区：切换任务时事件页重置回第 1 页", async () => {
    const client = createMockClient();
    const events = manyTaskEventsFixture(25);
    const rows: TaskRow[] = [
      {
        task_id: "bulk-events-A",
        op: "ingest",
        status: "succeeded",
        created_at: "2026-05-17T10:00:00Z",
        started_at: "2026-05-17T10:00:00Z",
        finished_at: "2026-05-17T10:01:00Z",
        params_digest: "evt-a",
        result: null,
        error: null
      },
      {
        task_id: "bulk-events-B",
        op: "ingest",
        status: "succeeded",
        created_at: "2026-05-17T11:00:00Z",
        started_at: "2026-05-17T11:00:00Z",
        finished_at: "2026-05-17T11:01:00Z",
        params_digest: "evt-b",
        result: null,
        error: null
      }
    ];
    client.listTasks.mockResolvedValue(toTaskListPage(rows.map(toTaskSummary)));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(events));

    render(<TasksPage client={client} />);
    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));
    await screen.findByText("25 events");
    const tape = screen.getByText("Event tape").closest("section") as HTMLElement;
    await userEvent.click(within(tape).getByRole("button", { name: /Next/i }));
    await waitFor(() => {
      expect(within(tape).getByText(/Page\s*2\s*\/\s*2/i)).toBeInTheDocument();
    });

    // 切到任务 B：事件清空 + 页码重置；再加载事件应回到 Page 1
    await userEvent.click(screen.getByText("bulk-events-B").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByText("Event tape")).not.toBeInTheDocument();
    });

    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));
    await screen.findByText("25 events");
    const tapeB = screen.getByText("Event tape").closest("section") as HTMLElement;
    expect(within(tapeB).getByText(/Page\s*1\s*\/\s*2/i)).toBeInTheDocument();
    expect(within(tapeB).getByText("#1")).toBeInTheDocument();
  });

  it("事件区：分页 nav aria-label 跟随 locale 本地化", async () => {
    const client = createMockClient();
    const events = manyTaskEventsFixture(25);
    const terminalRow: TaskRow = {
      task_id: "bulk-events-loc",
      op: "ingest",
      status: "succeeded",
      created_at: "2026-05-17T10:00:00Z",
      started_at: "2026-05-17T10:00:00Z",
      finished_at: "2026-05-17T10:01:00Z",
      params_digest: "evt",
      result: null,
      error: null
    };
    client.listTasks.mockResolvedValue(toTaskListPage([toTaskSummary(terminalRow)]));
    client.streamTaskEvents.mockImplementation(() => createAsyncEvents(events));

    const { unmount } = render(<TasksPage client={client} locale="zh-CN" />);
    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));
    await screen.findByText("25 events");
    expect(screen.getByRole("navigation", { name: "事件分页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeInTheDocument();
    unmount();

    render(<TasksPage client={client} locale="en" />);
    await userEvent.click(await screen.findByRole("button", { name: /Load events/ }));
    await screen.findByText("25 events");
    expect(screen.getByRole("navigation", { name: "event pagination" })).toBeInTheDocument();
  });

  it("选择其它任务时中止正在 Follow 的事件流", async () => {
    const client = createMockClient();
    const runningRow: TaskRow = {
      ...manyTaskRowsFixture[0],
      task_id: "bulk-task-01",
      status: "running",
      finished_at: null,
      result: null
    };
    const rows: TaskRow[] = [runningRow, ...manyTaskRowsFixture.slice(1)];
    client.listTasks.mockResolvedValue(toTaskListPage(rows.map(toTaskSummary)));
    client.getTask.mockImplementation((id: string) =>
      Promise.resolve(manyTaskRowsFixture.find((row) => row.task_id === id))
    );
    client.streamTaskEvents.mockImplementation(() =>
      createPendingEvents([
        {
          type: "progress",
          seq: 1,
          ts: "2026-05-17T00:00:00Z",
          phase: "ingest",
          current: 1,
          total: 10
        } as TaskEvent
      ])
    );

    render(<TasksPage client={client} />);

    await screen.findByText("bulk-task-01");
    await userEvent.click(await screen.findByRole("button", { name: /^Follow$/ }));
    expect(await screen.findByText("1 events")).toBeInTheDocument();

    const lastCall = client.streamTaskEvents.mock.calls.at(-1) as [string, number | undefined, AbortSignal];
    const signal = lastCall[2];
    expect(signal.aborted).toBe(false);

    await userEvent.click(screen.getByText("bulk-task-02").closest("button") as HTMLElement);

    await waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
  });
});

async function* createPendingEvents<T>(events: T[]): AsyncGenerator<T> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
  await new Promise(() => undefined);
}

function createControlledAgentStream() {
  const queue: AgentStreamEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;

  return {
    push(event: AgentStreamEvent) {
      queue.push(event);
      wake?.();
      wake = null;
    },
    finish() {
      finished = true;
      wake?.();
      wake = null;
    },
    async *stream(): AsyncGenerator<AgentStreamEvent> {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift() as AgentStreamEvent;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
  };
}

function createControlledTaskEventStream() {
  const queue: TaskEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;

  return {
    push(event: TaskEvent) {
      queue.push(event);
      wake?.();
      wake = null;
    },
    finish() {
      finished = true;
      wake?.();
      wake = null;
    },
    async *stream(): AsyncGenerator<TaskEvent> {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift() as TaskEvent;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
  };
}

function makeProgressEvent(seq: number, total: number): TaskEvent {
  return {
    type: "progress",
    seq,
    ts: `2026-05-17T10:00:${String(seq % 60).padStart(2, "0")}Z`,
    phase: "embed_chunks",
    current: seq,
    total
  };
}
