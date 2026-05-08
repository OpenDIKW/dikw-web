import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView", () => {
  it("renders frontmatter metadata and markdown structures", () => {
    render(
      <MarkdownView
        body={
          "---\ntitle: Architecture\ntags:\n- DIKW\nsources:\n- source/a.md\n---\n\n# Architecture\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n"
        }
      />
    );

    expect(screen.getByLabelText("Document metadata")).toBeInTheDocument();
    expect(screen.getByText("#DIKW")).toBeInTheDocument();
    expect(screen.getByText("source/a.md")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Architecture", level: 1 })).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-body table")).toBeInTheDocument();
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
  });

  it("turns wikilinks into buttons with the target callback", async () => {
    const onWikiLink = vi.fn();
    render(<MarkdownView body="See [[Synthesis|the synthesis page]]." onWikiLink={onWikiLink} />);

    await userEvent.click(screen.getByRole("button", { name: "the synthesis page" }));
    expect(onWikiLink).toHaveBeenCalledWith("Synthesis");
  });
});
