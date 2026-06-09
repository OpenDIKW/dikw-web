import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiPage } from "./WikiPage";
import { createMockClient } from "../test/mockClient";
import type { DocumentRecord, PageReadResult } from "../types";

const TOGGLE_ARIA = "在原文旁显示 AI 中文翻译";

function doc(path: string, title: string): DocumentRecord {
  return {
    doc_id: path,
    path,
    path_key: path,
    title,
    hash: "h",
    mtime: 1777819200,
    layer: "knowledge",
    active: true,
  };
}

function page(path: string, title: string, body: string): PageReadResult {
  return {
    doc_id: path,
    path,
    layer: "knowledge",
    title,
    body,
    anchors: [],
    assets: [],
    frontmatter: {},
  };
}

const enPage = page(
  "knowledge/dikw.md",
  "The DIKW Pyramid",
  "# The DIKW Pyramid\n\nThe DIKW pyramid models data, information, knowledge and wisdom.",
);
const zhPage = page(
  "knowledge/cengci.md",
  "知识层次",
  "# 知识层次\n\n数据、信息、知识与智慧构成完整的认知层级,逐层提炼。",
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubTranslateFetch(opts: { enabled: boolean; result?: unknown }) {
  const calls = { health: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/web/translate/health")) {
      calls.health += 1;
      return jsonResponse({ enabled: opts.enabled });
    }
    if (url.includes("/web/translate/submit")) return jsonResponse({ jobId: "j1" }, 202);
    if (url.endsWith("/jobs/j1/result")) return jsonResponse(opts.result ?? { blocks: [] });
    if (url.endsWith("/jobs/j1")) return jsonResponse({ status: "succeeded" });
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function clientFor(docs: DocumentRecord[], body: PageReadResult) {
  const client = createMockClient();
  client.get.mockImplementation((path: string) => {
    if (path === "/v1/base/pages") return Promise.resolve(docs);
    if (path.startsWith("/v1/base/pages/")) return Promise.resolve(body);
    return Promise.reject(new Error(`Unexpected path ${path}`));
  });
  return client;
}

afterEach(() => vi.unstubAllGlobals());

describe("WikiPage bilingual reading", () => {
  it("offers the AI translate toggle on an English page and switches to dual columns", async () => {
    stubTranslateFetch({
      enabled: true,
      result: {
        blocks: [
          { i: 0, tr: "# DIKW 金字塔" },
          { i: 1, tr: "DIKW 金字塔建模数据、信息、知识与智慧。" },
        ],
      },
    });
    render(
      <WikiPage
        client={clientFor([doc("knowledge/dikw.md", "The DIKW Pyramid")], enPage)}
        locale="zh-CN"
      />,
    );

    expect(await screen.findByText(/DIKW pyramid models/)).toBeInTheDocument();
    const toggle = await screen.findByRole("button", { name: TOGGLE_ARIA });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(document.querySelector(".bilingual-cols")).not.toBeNull());
    expect(await screen.findByText("DIKW 金字塔建模数据、信息、知识与智慧。")).toBeInTheDocument();
  });

  it("shows no translate toggle on a Chinese page", async () => {
    const calls = stubTranslateFetch({ enabled: true });
    render(
      <WikiPage
        client={clientFor([doc("knowledge/cengci.md", "知识层次")], zhPage)}
        locale="zh-CN"
      />,
    );

    expect(await screen.findByText(/认知层级/)).toBeInTheDocument();
    await waitFor(() => expect(calls.health).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: TOGGLE_ARIA })).toBeNull();
  });

  it("hides the translate toggle when the sidecar translator is unavailable", async () => {
    const calls = stubTranslateFetch({ enabled: false });
    render(
      <WikiPage
        client={clientFor([doc("knowledge/dikw.md", "The DIKW Pyramid")], enPage)}
        locale="zh-CN"
      />,
    );

    expect(await screen.findByText(/DIKW pyramid models/)).toBeInTheDocument();
    await waitFor(() => expect(calls.health).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: TOGGLE_ARIA })).toBeNull();
  });
});
