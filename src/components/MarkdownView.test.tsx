import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

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
