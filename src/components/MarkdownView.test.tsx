import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { MarkdownView } from "./MarkdownView";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => {
      if (source.includes("broken")) {
        throw new Error("Invalid Mermaid");
      }
      return { svg: '<svg role="img" data-testid="mermaid-svg"><text>flowchart</text></svg>' };
    })
  }
}));

describe("MarkdownView", () => {
  it("renders metadata and keeps one document title in the markdown reader", () => {
    const { rerender } = render(
      <MarkdownView
        fallbackTitle="Architecture"
        body={
          "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\n---\n\n# Architecture\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n"
        }
      />
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
      />
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
      />
    );

    expect(document.querySelector(".markdown-body script")).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-body [onclick]")).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-table-wrap table")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(document.querySelector(".markdown-body > div:not(.markdown-table-wrap)")).not.toBeInTheDocument();
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
      />
    );

    const details = document.querySelectorAll(".markdown-details");
    expect(details).toHaveLength(2);
    expect(details[0]).toHaveAttribute("open");
    expect(details[1]).not.toHaveAttribute("open");
    expect(screen.getByText("flowchart")).toBeInTheDocument();
    expect(screen.getByText("bold detail").tagName.toLowerCase()).toBe("strong");
    expect(screen.queryByText(/<details/)).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-body > div:not(.markdown-table-wrap)")).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText("Mermaid diagram could not be rendered.")).toBeInTheDocument());
    expect(screen.getByText("broken graph")).toBeInTheDocument();
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        suppressErrorRendering: true
      })
    );
  });

  it("turns wikilinks into buttons with the target callback", async () => {
    const onWikiLink = vi.fn();
    render(<MarkdownView body="See [[Synthesis|the synthesis page]]." onWikiLink={onWikiLink} />);

    await userEvent.click(screen.getByRole("button", { name: "the synthesis page" }));
    expect(onWikiLink).toHaveBeenCalledWith("Synthesis");
  });

  it("keeps hash routing intact when following in-document heading anchors", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#wiki";

    try {
      render(<MarkdownView body={"[第1章](#第1章)\n\n# 第1章\n\n正文。"} />);
      expect(screen.getByRole("heading", { name: "第1章" })).toHaveAttribute("id", "第1章");

      await userEvent.click(screen.getByRole("link", { name: "第1章" }));

      expect(window.location.hash).toBe("#wiki");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
