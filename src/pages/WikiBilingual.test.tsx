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
    if (url.endsWith("/jobs/j1/cancel")) return jsonResponse({ jobId: "j1", ok: true });
    if (url.endsWith("/jobs/j1")) return jsonResponse({ status: "succeeded" });
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Like stubTranslateFetch, but each submit gets its own job whose result is
 *  computed from the submitted blocks — so the body translation and a preview
 *  (title + summary) translation can coexist with different outputs. */
function stubTranslateFetchPerSubmit(
  handler: (blocks: string[]) => Array<{ i: number; tr: string }>,
) {
  const calls = { submits: [] as string[][] };
  const results = new Map<string, unknown>();
  let n = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/web/translate/health")) return jsonResponse({ enabled: true });
      if (url.includes("/web/translate/submit")) {
        const blocks = (JSON.parse(String(init?.body)) as { blocks: string[] }).blocks;
        calls.submits.push(blocks);
        n += 1;
        const jobId = `j${n}`;
        results.set(jobId, { blocks: handler(blocks) });
        return jsonResponse({ jobId }, 202);
      }
      const result = /\/jobs\/(j\d+)\/result$/.exec(url);
      if (result) return jsonResponse(results.get(result[1]));
      if (/\/jobs\/j\d+\/cancel$/.test(url)) return jsonResponse({ ok: true });
      if (/\/jobs\/j\d+$/.test(url)) return jsonResponse({ status: "succeeded" });
      throw new Error(`Unexpected fetch ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function clientFor(
  docs: DocumentRecord[],
  bodies: PageReadResult | Record<string, PageReadResult>,
) {
  const client = createMockClient();
  client.get.mockImplementation((path: string) => {
    if (path === "/v1/base/pages") return Promise.resolve(docs);
    if (path.startsWith("/v1/base/pages/")) {
      if ("path" in bodies && typeof bodies.path === "string") return Promise.resolve(bodies);
      const rest = decodeURIComponent(path.replace("/v1/base/pages/", ""));
      const match = (bodies as Record<string, PageReadResult>)[rest];
      if (match) return Promise.resolve(match);
    }
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
    const toggle = await screen.findByRole("switch", { name: TOGGLE_ARIA });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
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
    expect(screen.queryByRole("switch", { name: TOGGLE_ARIA })).toBeNull();
  });

  it("translates the wikilink preview card (title + summary + AI badge) for a translated-column click", async () => {
    const linkedPage = page(
      "knowledge/dikw.md",
      "The DIKW Pyramid",
      "# The DIKW Pyramid\n\nSee [[Wisdom Layer|the wisdom layer]] for the practice of judgment.",
    );
    const wisdomPage = page(
      "knowledge/wisdom.md",
      "Wisdom Layer",
      "# Wisdom Layer\n\nWisdom is the practical application of accumulated knowledge and sound judgment.",
    );
    const calls = stubTranslateFetchPerSubmit((blocks) => {
      if (blocks[0] === "Wisdom Layer") {
        // The preview translation: [title, summary].
        return [
          { i: 0, tr: "智慧层" },
          { i: 1, tr: "智慧是积累的知识与判断在实践中的运用。" },
        ];
      }
      // The body translation — keep the wikilink clickable in the tr column.
      return [
        { i: 0, tr: "# DIKW 金字塔" },
        { i: 1, tr: "实践判断见 [[Wisdom Layer|智慧层]]。" },
      ];
    });
    render(
      <WikiPage
        client={clientFor(
          [
            doc("knowledge/dikw.md", "The DIKW Pyramid"),
            doc("knowledge/wisdom.md", "Wisdom Layer"),
          ],
          { "knowledge/dikw.md": linkedPage, "knowledge/wisdom.md": wisdomPage },
        )}
        initialPath="knowledge/dikw.md"
        locale="zh-CN"
      />,
    );

    await userEvent.click(await screen.findByRole("switch", { name: TOGGLE_ARIA }));
    await waitFor(() =>
      expect(document.querySelector(".bi-block--tr .inline-wikilink")).not.toBeNull(),
    );

    await userEvent.click(document.querySelector<HTMLElement>(".bi-block--tr .inline-wikilink")!);

    // The card swaps to the translated title + summary and carries the AI badge.
    expect(await screen.findByRole("heading", { name: "智慧层" })).toBeInTheDocument();
    expect(screen.getByText(/智慧是积累的知识与判断在实践中的运用/)).toBeInTheDocument();
    expect(document.querySelector(".wiki-preview-card__ai")).not.toBeNull();
    expect(calls.submits.some((blocks) => blocks[0] === "Wisdom Layer")).toBe(true);
  });

  it("keeps the original preview card (no badge, no extra translate call) for a source-column click", async () => {
    const linkedPage = page(
      "knowledge/dikw.md",
      "The DIKW Pyramid",
      "# The DIKW Pyramid\n\nSee [[Wisdom Layer|the wisdom layer]] for the practice of judgment.",
    );
    const wisdomPage = page(
      "knowledge/wisdom.md",
      "Wisdom Layer",
      "# Wisdom Layer\n\nWisdom is the practical application of accumulated knowledge and sound judgment.",
    );
    const calls = stubTranslateFetchPerSubmit(() => [
      { i: 0, tr: "# DIKW 金字塔" },
      { i: 1, tr: "实践判断见 [[Wisdom Layer|智慧层]]。" },
    ]);
    render(
      <WikiPage
        client={clientFor(
          [
            doc("knowledge/dikw.md", "The DIKW Pyramid"),
            doc("knowledge/wisdom.md", "Wisdom Layer"),
          ],
          { "knowledge/dikw.md": linkedPage, "knowledge/wisdom.md": wisdomPage },
        )}
        initialPath="knowledge/dikw.md"
        locale="zh-CN"
      />,
    );

    await userEvent.click(await screen.findByRole("switch", { name: TOGGLE_ARIA }));
    await waitFor(() =>
      expect(document.querySelector(".bi-block--src .inline-wikilink")).not.toBeNull(),
    );

    await userEvent.click(document.querySelector<HTMLElement>(".bi-block--src .inline-wikilink")!);

    // Original-language card: English title, no AI badge, and only the body
    // translation ever hit /web/translate (no preview submit).
    expect(await screen.findByRole("heading", { name: "Wisdom Layer" })).toBeInTheDocument();
    expect(document.querySelector(".wiki-preview-card__ai")).toBeNull();
    expect(calls.submits).toHaveLength(1);
  });

  it("rejects a partial preview translation rather than show a half-translated card", async () => {
    const linkedPage = page(
      "knowledge/dikw.md",
      "The DIKW Pyramid",
      "# The DIKW Pyramid\n\nSee [[Wisdom Layer|the wisdom layer]] for the practice of judgment.",
    );
    const wisdomPage = page(
      "knowledge/wisdom.md",
      "Wisdom Layer",
      "# Wisdom Layer\n\nWisdom is the practical application of accumulated knowledge and sound judgment.",
    );
    const calls = stubTranslateFetchPerSubmit((blocks) => {
      if (blocks[0] === "Wisdom Layer") {
        // Title translated, but the summary block came back empty (a dropped
        // block): the card must NOT show an EN/中 mix under the AI badge.
        return [
          { i: 0, tr: "智慧层" },
          { i: 1, tr: "" },
        ];
      }
      return [
        { i: 0, tr: "# DIKW 金字塔" },
        { i: 1, tr: "实践判断见 [[Wisdom Layer|智慧层]]。" },
      ];
    });
    render(
      <WikiPage
        client={clientFor(
          [
            doc("knowledge/dikw.md", "The DIKW Pyramid"),
            doc("knowledge/wisdom.md", "Wisdom Layer"),
          ],
          { "knowledge/dikw.md": linkedPage, "knowledge/wisdom.md": wisdomPage },
        )}
        initialPath="knowledge/dikw.md"
        locale="zh-CN"
      />,
    );

    await userEvent.click(await screen.findByRole("switch", { name: TOGGLE_ARIA }));
    await waitFor(() =>
      expect(document.querySelector(".bi-block--tr .inline-wikilink")).not.toBeNull(),
    );

    await userEvent.click(document.querySelector<HTMLElement>(".bi-block--tr .inline-wikilink")!);

    // The preview translation was attempted, but the partial result is rejected:
    // the card keeps the English original and shows no AI badge.
    await waitFor(() =>
      expect(calls.submits.some((blocks) => blocks[0] === "Wisdom Layer")).toBe(true),
    );
    expect(await screen.findByRole("heading", { name: "Wisdom Layer" })).toBeInTheDocument();
    expect(document.querySelector(".wiki-preview-card__ai")).toBeNull();
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
    expect(screen.queryByRole("switch", { name: TOGGLE_ARIA })).toBeNull();
  });
});
