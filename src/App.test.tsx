import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  healthFixture,
  infoFixture,
  statusFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
  wisdomItemsFixture
} from "./test/fixtures";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
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
      if (url.pathname === "/v1/base/pages") {
        return jsonResponse(wikiPagesFixture);
      }
      if (url.pathname.startsWith("/v1/base/pages/")) {
        const selectedPath = decodeURIComponent(url.pathname.replace("/v1/base/pages/", ""));
        return jsonResponse(wikiPageBodiesFixture[selectedPath]);
      }
      if (url.pathname === "/v1/wisdom") {
        return jsonResponse(wisdomItemsFixture);
      }
      if (url.pathname === "/v1/tasks") {
        return jsonResponse([]);
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    })
  );
}

describe("App shell", () => {
  it("renders localized navigation and moves connection settings into Settings", async () => {
    stubApi();
    window.location.hash = "#overview";

    render(<App />);

    const mark = screen.getByRole("img", { name: "OpenDIKW" });
    expect(mark).toHaveAttribute("src", "/opendikw-avatar.png");
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "概览" })).not.toBeInTheDocument();
    expect(await screen.findByText("dikw-core 0.2.0")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("同源代理，或 http://127.0.0.1:8765")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Bearer token")).not.toBeInTheDocument();
    expect(screen.getByText("same-origin /v1 proxy")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(window.location.hash).toBe("#settings");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://127.0.0.1:8765" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "secret" } });
    await waitFor(() => {
      expect(sessionStorage.getItem("dikw-web.serverUrl")).toBe("http://127.0.0.1:8765");
      expect(sessionStorage.getItem("dikw-web.token")).toBe("secret");
    });

    await userEvent.click(screen.getByRole("button", { name: "Knowledge" }));
    expect(await screen.findByRole("heading", { name: "Knowledge" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#wiki");

    await userEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(await screen.findByRole("heading", { name: "Graph" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#graph");

    await userEvent.click(screen.getByRole("button", { name: "Wisdom" }));
    expect(await screen.findByRole("heading", { name: "Wisdom" })).toBeInTheDocument();
  });

  it("does not expose the removed artifacts route", async () => {
    stubApi();
    window.location.hash = "#artifacts";

    render(<App />);

    expect(screen.queryByRole("button", { name: /产物Artifacts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "产物工作台" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("persists locale and theme preferences in local storage", async () => {
    stubApi();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
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
    await userEvent.click(screen.getByRole("button", { name: "Open in Knowledge" }));

    expect(window.location.hash).toBe("#wiki");
    expect(await screen.findByRole("heading", { name: "Architecture", level: 1 })).toBeInTheDocument();
  });

});
