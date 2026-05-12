import { render, screen, waitFor } from "@testing-library/react";
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
  it("renders bilingual navigation and navigates by hash", async () => {
    stubApi();
    window.location.hash = "#overview";

    render(<App />);

    const mark = screen.getByRole("img", { name: "OpenDIKW" });
    expect(mark).toHaveAttribute("src", "/opendikw-avatar.png");
    expect(screen.getByText("概览")).toBeInTheDocument();
    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);
    expect(await screen.findByText("dikw-core 0.2.0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /知识库Wiki/ }));
    expect(await screen.findByRole("heading", { name: "知识库" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#wiki");

    await userEvent.click(screen.getByRole("button", { name: /图谱Graph/ }));
    expect(await screen.findByRole("heading", { name: "知识图谱" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#graph");

    await userEvent.click(screen.getByRole("button", { name: /智慧Wisdom/ }));
    expect(await screen.findByRole("heading", { name: "智慧沉淀" })).toBeInTheDocument();
  });

  it("does not expose the removed artifacts route", async () => {
    stubApi();
    window.location.hash = "#artifacts";

    render(<App />);

    expect(screen.queryByRole("button", { name: /产物Artifacts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "产物工作台" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "工作台概览" })).toBeInTheDocument();
  });

  it("persists connection settings in session storage", async () => {
    stubApi();
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText("同源代理，或 http://127.0.0.1:8765"), "http://127.0.0.1:8765");
    await userEvent.type(screen.getByPlaceholderText("Bearer token"), "secret");

    await waitFor(() => {
      expect(sessionStorage.getItem("dikw-web.serverUrl")).toBe("http://127.0.0.1:8765");
      expect(sessionStorage.getItem("dikw-web.token")).toBe("secret");
    });
  });

  it("opens a graph node in the wiki reader", async () => {
    stubApi();
    window.location.hash = "#graph";

    render(<App />);

    expect(await screen.findByRole("heading", { name: "知识图谱" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Architecture graph node" }));
    await userEvent.click(screen.getByRole("button", { name: "在知识库打开" }));

    expect(window.location.hash).toBe("#wiki");
    expect(await screen.findByRole("heading", { name: "Architecture", level: 1 })).toBeInTheDocument();
  });

});
