import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  healthFixture,
  infoFixture,
  graphResultFixture,
  statusFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
} from "./test/fixtures";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function stubApi() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === "/v1/info") {
      return jsonResponse(infoFixture);
    }
    if (url.pathname === "/v1/health") {
      return jsonResponse(healthFixture);
    }
    if (url.pathname === "/v1/status") {
      return jsonResponse(statusFixture);
    }
    if (url.pathname === "/v1/base/graph") {
      return jsonResponse(graphResultFixture);
    }
    if (url.pathname === "/v1/base/pages") {
      return jsonResponse(wikiPagesFixture);
    }
    if (url.pathname.startsWith("/v1/base/pages/")) {
      const selectedPath = decodeURIComponent(url.pathname.replace("/v1/base/pages/", ""));
      return jsonResponse(wikiPageBodiesFixture[selectedPath]);
    }
    if (url.pathname === "/v1/tasks") {
      return jsonResponse({ tasks: [], next_cursor: null, has_more: false });
    }
    if (url.pathname === "/agent/sessions") {
      if (init?.method === "POST") {
        return jsonResponse({
          id: "session-1",
          title: "New chat",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
          messageCount: 0,
          lastMessagePreview: "",
          messages: [],
          toolEvents: [],
          sources: [],
          proposals: [],
        });
      }
      return jsonResponse([]);
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("App shell", () => {
  it("renders localized navigation and moves connection settings into Settings", async () => {
    const fetchMock = stubApi();
    window.location.hash = "#overview";

    render(<App />);

    const mark = screen.getByRole("img", { name: "OpenDIKW" });
    expect(mark).toHaveAttribute("src", "/opendikw-avatar.png");
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "概览" })).not.toBeInTheDocument();
    expect(await screen.findByText("dikw-core 0.2.0")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("http://127.0.0.1:8765")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Bearer token")).not.toBeInTheDocument();
    expect(screen.queryByText(/same-origin/i)).not.toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8765")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining(["/v1/health", "/v1/status", "/v1/info"]),
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^http:\/\/127\.0\.0\.1:8765\/v1\//)]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(window.location.hash).toBe("#settings");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Server URL")).toHaveValue("http://127.0.0.1:8765");

    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "http://127.0.0.1:8765" },
    });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "secret" } });
    // Connection now persists on an explicit Save, to localStorage (shared
    // across tabs / survives a restart) rather than per-tab sessionStorage.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(localStorage.getItem("dikw-web.serverUrl")).toBe("http://127.0.0.1:8765");
      expect(localStorage.getItem("dikw-web.token")).toBe("secret");
    });

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Server URL")).toHaveValue("http://127.0.0.1:8765");
      expect(localStorage.getItem("dikw-web.serverUrl")).toBe("http://127.0.0.1:8765");
      expect(localStorage.getItem("dikw-web.token")).toBeNull();
    });

    await userEvent.click(screen.getByRole("button", { name: "Base" }));
    expect(await screen.findByRole("heading", { name: "Base" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#base");

    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(await screen.findByRole("heading", { name: "Graph" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#graph");

    await userEvent.click(screen.getByRole("button", { name: "Wisdom" }));
    expect(await screen.findByRole("heading", { name: "Wisdom" })).toBeInTheDocument();
  }, 15_000);

  it("uses #chat as the canonical conversation route and redirects legacy #query", async () => {
    stubApi();
    window.location.hash = "#chat";

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#chat");
    expect(screen.queryByRole("heading", { name: "Agent Chat" })).not.toBeInTheDocument();

    window.location.hash = "#query";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await waitFor(() => {
      expect(window.location.hash).toBe("#chat");
      expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    });
  });

  it("does not expose the removed artifacts route", async () => {
    stubApi();
    window.location.hash = "#artifacts";

    render(<App />);

    expect(screen.queryByRole("button", { name: /产物Artifacts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "产物工作台" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("hard-removes the legacy #wiki route and falls back to overview", async () => {
    stubApi();
    window.location.hash = "#wiki";

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Base" })).not.toBeInTheDocument();
  });

  it("persists locale and theme preferences in local storage", async () => {
    stubApi();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "简体中文" }));

    await waitFor(() => {
      expect(localStorage.getItem("dikw-web.locale")).toBe("zh-CN");
      expect(screen.getByRole("button", { name: "概览" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "深色" }));

    await waitFor(() => {
      expect(localStorage.getItem("dikw-web.theme")).toBe("dark");
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("opens a graph node in the wiki reader", async () => {
    stubApi();
    window.location.hash = "#graph";

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Graph" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Architecture graph node" }));
    await userEvent.click(screen.getByRole("button", { name: "Open in Base" }));

    expect(window.location.hash).toBe("#base");
    expect(
      await screen.findByRole("heading", { name: "Architecture", level: 1 }),
    ).toBeInTheDocument();
  });

  it("collapses the sidebar to an icon rail and persists the choice", async () => {
    stubApi();
    window.location.hash = "#overview";

    const { container } = render(<App />);

    const aside = container.querySelector(".sidebar");
    expect(aside).toHaveAttribute("data-collapsed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));

    await waitFor(() => {
      expect(aside).toHaveAttribute("data-collapsed", "true");
      expect(localStorage.getItem("dikw-web.sidebarCollapsed")).toBe("true");
    });
    // The control flips to the expand affordance, and nav buttons keep their
    // accessible names even though the labels are visually hidden in the rail.
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => {
      expect(aside).toHaveAttribute("data-collapsed", "false");
      expect(localStorage.getItem("dikw-web.sidebarCollapsed")).toBe("false");
    });
  });

  it("restores the collapsed sidebar from local storage on load", async () => {
    stubApi();
    localStorage.setItem("dikw-web.sidebarCollapsed", "true");
    window.location.hash = "#overview";

    const { container } = render(<App />);

    expect(container.querySelector(".sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("renders the configured brand name, logo alt, tab title, and Workbench breadcrumb", async () => {
    stubApi();
    window.location.hash = "#overview";

    render(<App branding={{ name: { en: "Maibo-DIKW", "zh-CN": "迈博知识库" } }} />);

    expect(screen.getByText("Maibo-DIKW")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Maibo-DIKW" })).toBeInTheDocument();
    expect(screen.getByText("Workbench")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Maibo-DIKW"));
  });

  it("localizes the configured brand name, tab title, and breadcrumb for zh-CN", async () => {
    stubApi();
    localStorage.setItem("dikw-web.locale", "zh-CN");
    window.location.hash = "#overview";

    render(<App branding={{ name: { en: "Maibo-DIKW", "zh-CN": "迈博知识库" } }} />);

    expect(screen.getByText("迈博知识库")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "迈博知识库" })).toBeInTheDocument();
    expect(screen.getByText("工作台")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("迈博知识库"));
  });

  it("defaults to OpenDIKW branding with a Workbench breadcrumb when unconfigured", async () => {
    stubApi();
    window.location.hash = "#overview";

    render(<App />);

    expect(screen.getByText("OpenDIKW")).toBeInTheDocument();
    expect(screen.getByText("Workbench")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("OpenDIKW"));
  });
});
