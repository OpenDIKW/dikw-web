import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { MarkdownView } from "./MarkdownView";
import type { PageAsset } from "../types";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => {
      if (source.includes("broken")) {
        throw new Error("Invalid Mermaid");
      }
      return { svg: '<svg role="img" data-testid="mermaid-svg"><text>flowchart</text></svg>' };
    }),
  },
}));

const echartsSetOptionMock = vi.fn();
const echartsInitMock = vi.fn((_el?: HTMLElement, _theme?: string) => ({
  setOption: echartsSetOptionMock,
  dispose: vi.fn(),
  resize: vi.fn(),
}));

vi.mock("echarts/core", () => ({
  init: echartsInitMock,
  use: vi.fn(),
}));
vi.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  ScatterChart: {},
  HeatmapChart: {},
}));
vi.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  TitleComponent: {},
  VisualMapComponent: {},
}));
vi.mock("echarts/renderers", () => ({
  CanvasRenderer: {},
}));

function makeAsset(overrides: Partial<PageAsset> = {}): PageAsset {
  return {
    asset_id: "1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72",
    kind: "image",
    mime: "image/jpeg",
    bytes: 1234,
    original_paths: [
      "assets/images/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg",
    ],
    media_meta: null,
    url: "/v1/assets/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72",
    ...overrides,
  };
}

describe("MarkdownView", () => {
  it("renders metadata and keeps one document title in the markdown reader", () => {
    const { rerender } = render(
      <MarkdownView
        fallbackTitle="Architecture"
        body={
          "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\n---\n\n# Architecture\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n"
        }
      />,
    );

    expect(screen.getByLabelText("Document metadata")).toBeInTheDocument();
    expect(screen.getByText("#DIKW")).toBeInTheDocument();
    expect(screen.getByText("source/a.md")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Architecture", level: 1 })).toHaveLength(1);
    expect(document.querySelector(".markdown-body table")).toBeInTheDocument();
    expect(screen.getByText("const x = 1")).toBeInTheDocument();

    rerender(<MarkdownView fallbackTitle="Untitled Page" body="Body without a top heading." />);

    expect(screen.getByRole("heading", { name: "Untitled Page", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Body without a top heading.")).toBeInTheDocument();
  });

  it("renders safe raw html tables as real tables", () => {
    render(
      <MarkdownView
        body={
          "Before\n\n<table><caption>Hybrid studies</caption><thead><tr><th>First principles</th><th>Training</th></tr></thead><tbody><tr><td>Mass balance<br>kinetics</td><td>FBA</td></tr></tbody></table>\n\nAfter"
        }
      />,
    );

    const wrapper = document.querySelector(".markdown-table-wrap");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("Hybrid studies")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "First principles" })).toBeInTheDocument();
    expect(screen.getByText(/Mass balance/)).toBeInTheDocument();
    expect(screen.queryByText(/<table>/)).not.toBeInTheDocument();
  });

  it("strips unsafe html while keeping sanitized raw tables", () => {
    render(
      <MarkdownView
        body={
          '<script>alert("x")</script>\n\n<div onclick="bad()">not table</div>\n\n<table onclick="bad()"><tr><td onclick="bad()">A<script>alert("x")</script></td></tr></table>'
        }
      />,
    );

    expect(document.querySelector(".markdown-body script")).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-body [onclick]")).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-table-wrap table")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(
      document.querySelector(".markdown-body > div:not(.markdown-table-wrap)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/not table/)).toBeInTheDocument();
  });

  it("renders inline and block latex with KaTeX", () => {
    render(<MarkdownView body={"Inline $\\mathrm { C O } _ { 2 }$.\n\n$$x^2 + y^2 = z^2$$"} />);

    const mathNodes = document.querySelectorAll(".katex");
    expect(mathNodes.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".katex-display")).toBeInTheDocument();
    expect(screen.queryByText(/\$\\mathrm/)).not.toBeInTheDocument();
  });

  it("renders safe details blocks while leaving arbitrary html escaped", () => {
    render(
      <MarkdownView
        body={
          '<details open><summary>flowchart</summary>\n\n**bold detail**\n\n</details>\n\n<details><summary>notes</summary>\n\nplain detail\n\n</details>\n\n<div onclick="bad()">not allowed</div>'
        }
      />,
    );

    const details = document.querySelectorAll(".markdown-details");
    expect(details).toHaveLength(2);
    expect(details[0]).toHaveAttribute("open");
    expect(details[1]).not.toHaveAttribute("open");
    expect(screen.getByText("flowchart")).toBeInTheDocument();
    expect(screen.getByText("bold detail").tagName.toLowerCase()).toBe("strong");
    expect(screen.queryByText(/<details/)).not.toBeInTheDocument();
    expect(
      document.querySelector(".markdown-body > div:not(.markdown-table-wrap)"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/not allowed/)).toBeInTheDocument();
  });

  it("renders Mermaid fences as SVG diagrams", async () => {
    render(<MarkdownView body={"```mermaid\ngraph LR\nA --> B\n```"} />);

    const diagram = document.querySelector(".mermaid-diagram");
    expect(diagram).toBeInTheDocument();
    expect(diagram?.querySelector(".mermaid-fallback")).toHaveAttribute("hidden");
    await waitFor(() => expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument());
    expect(diagram?.querySelector(".mermaid-fallback")).not.toBeInTheDocument();
  });

  it("keeps a readable Mermaid fallback when rendering fails", async () => {
    vi.mocked(mermaid.initialize).mockClear();

    render(<MarkdownView body={"```mermaid\nbroken graph\n```"} />);

    await waitFor(() =>
      expect(screen.getByText("Mermaid diagram could not be rendered.")).toBeInTheDocument(),
    );
    expect(screen.getByText("broken graph")).toBeInTheDocument();
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        suppressErrorRendering: true,
      }),
    );
  });

  it("turns wikilinks into buttons with the target callback", async () => {
    const onWikiLink = vi.fn();
    render(<MarkdownView body="See [[Synthesis|the synthesis page]]." onWikiLink={onWikiLink} />);

    await userEvent.click(screen.getByRole("button", { name: "the synthesis page" }));
    expect(onWikiLink).toHaveBeenCalledWith("Synthesis");
  });

  it("renders Obsidian image embed against the matching PageAsset url", () => {
    const asset = makeAsset();
    render(
      <MarkdownView
        body={
          "Caption text.\n\n![[assets/images/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg]]"
        }
        assets={[asset]}
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(asset.url);
    expect(img!.getAttribute("loading")).toBe("lazy");
  });

  it("resolves Obsidian image embed by SHA-256 in filename when original_paths is empty", () => {
    const asset = makeAsset({ original_paths: [] });
    render(
      <MarkdownView
        body={"![[anywhere/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg]]"}
        assets={[asset]}
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(asset.url);
  });

  it("renders a broken-image placeholder when the asset is not in the assets list", () => {
    render(<MarkdownView body={"![[assets/images/deadbeef.jpg]]"} assets={[]} />);
    const placeholder = document.querySelector(".md-broken-image");
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("assets/images/deadbeef.jpg");
    expect(document.querySelector("img.markdown-image")).toBeNull();
  });

  it("prefixes asset URLs with assetBaseUrl when provided", () => {
    const asset = makeAsset();
    render(
      <MarkdownView
        body={
          "![[assets/images/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg]]"
        }
        assets={[asset]}
        assetBaseUrl="http://core.example:8765"
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(`http://core.example:8765${asset.url}`);
  });

  it("hydrates Obsidian image embeds via authenticated fetch when assetToken is provided", async () => {
    const asset = makeAsset();
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      );
    const blobUrl = "blob:http://localhost/asset-blob";
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    try {
      const { unmount } = render(
        <MarkdownView
          body={
            "![[assets/images/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg]]"
          }
          assets={[asset]}
          assetToken="secret-token"
        />,
      );
      const initial = document.querySelector<HTMLImageElement>("img.markdown-image");
      expect(initial).not.toBeNull();
      expect(initial!.getAttribute("src")).toBeNull();
      expect(initial!.dataset.assetSrc).toBe(asset.url);

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({
        headers: { Authorization: "Bearer secret-token" },
      });

      await waitFor(() => {
        const updated = document.querySelector<HTMLImageElement>("img.markdown-image");
        expect(updated?.getAttribute("src")).toBe(blobUrl);
      });
      expect(createObjectUrlSpy).toHaveBeenCalled();

      unmount();
      expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    } finally {
      fetchSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("re-fetches an authenticated image when the token changes", async () => {
    const asset = makeAsset();
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      );
    let blobCounter = 0;
    const createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:http://localhost/asset-${++blobCounter}`);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    try {
      const body =
        "![[assets/images/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.jpg]]";
      const { rerender } = render(
        <MarkdownView body={body} assets={[asset]} assetToken="token-a" />,
      );
      await waitFor(() => {
        const img = document.querySelector<HTMLImageElement>("img.markdown-image");
        expect(img?.getAttribute("src")).toBe("blob:http://localhost/asset-1");
      });
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({
        headers: { Authorization: "Bearer token-a" },
      });

      rerender(<MarkdownView body={body} assets={[asset]} assetToken="token-b" />);
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(fetchSpy.mock.calls[1][1]).toMatchObject({
        headers: { Authorization: "Bearer token-b" },
      });
      expect(revokeSpy).toHaveBeenCalledWith("blob:http://localhost/asset-1");
    } finally {
      fetchSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeSpy.mockRestore();
    }
  });

  it("renders standard ![alt](path) against the matching PageAsset url", () => {
    const asset = makeAsset({
      original_paths: [
        "./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png",
      ],
    });
    render(
      <MarkdownView
        body={
          "Caption.\n\n![Kitchen](./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png)"
        }
        assets={[asset]}
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(asset.url);
    expect(img!.getAttribute("alt")).toBe("Kitchen");
    expect(img!.getAttribute("loading")).toBe("lazy");
  });

  it("prefixes standard image asset URLs with assetBaseUrl when provided", () => {
    const asset = makeAsset({
      original_paths: [
        "./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png",
      ],
    });
    render(
      <MarkdownView
        body={
          "![Kitchen](./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png)"
        }
        assets={[asset]}
        assetBaseUrl="http://core.example:8765"
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(`http://core.example:8765${asset.url}`);
  });

  it("lets standard remote image URLs pass through with markdown-image class for styling", () => {
    render(<MarkdownView body={"![Cat](https://example.com/cat.png)"} assets={[]} />);
    expect(document.querySelector(".md-broken-image")).toBeNull();
    const img = document.querySelector<HTMLImageElement>(".markdown-body img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/cat.png");
    // Class is kept so .markdown-image CSS applies uniformly; hydration is
    // already gated on data-asset-src (absent for remote), so this is safe.
    expect(img!.classList.contains("markdown-image")).toBe(true);
    expect(img!.hasAttribute("data-asset-src")).toBe(false);
  });

  it("resolves standard ![](path) when markdown-it percent-encodes a non-ASCII path", () => {
    const asset = makeAsset({
      mime: "image/png",
      asset_id: "2222222222222222222222222222222222222222222222222222222222222222",
      url: "/v1/assets/2222222222222222222222222222222222222222222222222222222222222222",
      original_paths: ["./images/封面.png"],
    });
    render(<MarkdownView body={"![cover](./images/封面.png)"} assets={[asset]} />);
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(asset.url);
    expect(document.querySelector(".md-broken-image")).toBeNull();
  });

  it("strips inline markup from standard image alt text per CommonMark", () => {
    const asset = makeAsset({
      original_paths: [
        "./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png",
      ],
    });
    render(
      <MarkdownView
        body={
          "![Figure **1**: see _intro_](./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png)"
        }
        assets={[asset]}
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("Figure 1: see intro");
  });

  it("preserves the title attribute on standard image syntax for local assets", () => {
    const asset = makeAsset({
      original_paths: [
        "./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png",
      ],
    });
    render(
      <MarkdownView
        body={
          '![Kitchen](./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png "厨房场景")'
        }
        assets={[asset]}
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("title")).toBe("厨房场景");
  });

  it("keeps title on standard image hydration when assetToken is provided", () => {
    const asset = makeAsset({
      original_paths: [
        "./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png",
      ],
    });
    render(
      <MarkdownView
        body={
          '![Kitchen](./images/scenes/1cdf336db39595a85c787a23c42fce7571e5aa6c4783ddc3225a48f9677a0a72.png "厨房场景")'
        }
        assets={[asset]}
        assetToken="secret-token"
      />,
    );
    const img = document.querySelector<HTMLImageElement>("img.markdown-image");
    expect(img).not.toBeNull();
    expect(img!.dataset.assetSrc).toBe(asset.url);
    expect(img!.getAttribute("title")).toBe("厨房场景");
    expect(img!.getAttribute("src")).toBeNull();
  });

  it("renders empty ![]() as nothing rather than a broken-image warning", () => {
    render(<MarkdownView body={"Caption.\n\n![]()\n\nMore."} assets={[]} />);
    expect(document.querySelector(".md-broken-image")).toBeNull();
    expect(document.querySelector(".markdown-body img")).toBeNull();
  });

  it("renders a broken-image placeholder for standard syntax when the asset is missing", () => {
    render(<MarkdownView body={"![Missing](./images/scenes/missing.png)"} assets={[]} />);
    const placeholder = document.querySelector(".md-broken-image");
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("./images/scenes/missing.png");
    expect(document.querySelector("img.markdown-image")).toBeNull();
  });

  it("renders a bar chart placeholder and invokes echarts setOption", async () => {
    echartsInitMock.mockClear();
    echartsSetOptionMock.mockClear();
    render(
      <MarkdownView
        body={
          "<details>\n<summary>bar</summary>\n\n| Run | Acid |\n| --- | --- |\n| Ctrl | 17 |\n| Innovator | 25 |\n</details>"
        }
      />,
    );
    const chart = document.querySelector('.markdown-chart[data-chart-type="bar"]');
    expect(chart).not.toBeNull();
    await waitFor(() => expect(echartsInitMock).toHaveBeenCalled());
    expect(echartsSetOptionMock).toHaveBeenCalled();
    const option = echartsSetOptionMock.mock.calls[0][0] as {
      series: Array<{ type: string; data: number[] }>;
    };
    expect(option.series[0].type).toBe("bar");
    expect(option.series[0].data).toEqual([17, 25]);
  });

  it("initializes echarts with the dark theme when the document is in dark mode", async () => {
    echartsInitMock.mockClear();
    echartsSetOptionMock.mockClear();
    const prevTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "dark";
    try {
      render(
        <MarkdownView
          body={
            "<details>\n<summary>bar</summary>\n\n| Run | Acid |\n| --- | --- |\n| Ctrl | 17 |\n</details>"
          }
        />,
      );
      await waitFor(() => expect(echartsInitMock).toHaveBeenCalled());
      const initArgs = echartsInitMock.mock.calls[0];
      expect(initArgs[1]).toBe("dark");
    } finally {
      if (prevTheme === undefined) {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = prevTheme;
      }
    }
  });

  it("renders a heatmap chart from a square pipe table", async () => {
    echartsInitMock.mockClear();
    echartsSetOptionMock.mockClear();
    render(
      <MarkdownView
        body={
          "<details>\n<summary>heatmap</summary>\n\n| | Cu | Fe |\n| --- | --- | --- |\n| Cu | 1.00 | 0.00 |\n| Fe | 0.00 | 1.00 |\n</details>"
        }
      />,
    );
    expect(document.querySelector('.markdown-chart[data-chart-type="heatmap"]')).not.toBeNull();
    await waitFor(() => expect(echartsSetOptionMock).toHaveBeenCalled());
    const option = echartsSetOptionMock.mock.calls[0][0] as {
      series: Array<{ type: string }>;
      visualMap: unknown;
    };
    expect(option.series[0].type).toBe("heatmap");
    expect(option.visualMap).toBeDefined();
  });

  it("renders a fallback <details> table when echarts.init throws", async () => {
    echartsInitMock.mockClear();
    echartsSetOptionMock.mockClear();
    echartsInitMock.mockImplementationOnce(() => {
      throw new Error("canvas unavailable");
    });
    render(
      <MarkdownView
        body={
          "<details>\n<summary>bar</summary>\n\n| Run | Acid |\n| --- | --- |\n| Ctrl | 17 |\n| Innovator | 25 |\n</details>"
        }
      />,
    );
    await waitFor(() => {
      const chart = document.querySelector(".markdown-chart");
      expect(chart?.getAttribute("data-state")).toBe("error");
    });
    const fallback = document.querySelector(".markdown-chart .markdown-details");
    expect(fallback).not.toBeNull();
    const fallbackText = fallback?.textContent ?? "";
    expect(fallbackText).toContain("Run");
    expect(fallbackText).toContain("Ctrl");
    expect(fallbackText).toContain("17");
  });

  it("keeps the <details> fallback when a chart block has a malformed body", () => {
    echartsInitMock.mockClear();
    render(
      <MarkdownView
        body={"<details>\n<summary>bar</summary>\n\nNot a table at all.\n</details>"}
      />,
    );
    expect(document.querySelector(".markdown-chart")).toBeNull();
    expect(document.querySelector(".markdown-details")).not.toBeNull();
    expect(screen.getByText(/Not a table at all/)).toBeInTheDocument();
  });

  it("keeps hash routing intact when following in-document heading anchors", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#base";

    try {
      render(<MarkdownView body={"[第1章](#第1章)\n\n# 第1章\n\n正文。"} />);
      expect(screen.getByRole("heading", { name: "第1章" })).toHaveAttribute("id", "第1章");

      await userEvent.click(screen.getByRole("link", { name: "第1章" }));

      expect(window.location.hash).toBe("#base");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
