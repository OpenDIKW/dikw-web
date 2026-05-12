import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ArtifactShell } from "./ArtifactShell";
import type { ArtifactDocument } from "../artifacts/types";

describe("ArtifactShell", () => {
  it("renders structured sections and copies a markdown summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText }
    });
    const artifact: ArtifactDocument = {
      id: "artifact-1",
      kind: "knowledge_explainer",
      title: "Architecture explainer",
      source: { label: "wiki/architecture.md", view: "wiki", path: "wiki/architecture.md" },
      createdAt: "2026-05-12T10:00:00.000Z",
      tldr: "A compact view of the architecture page.",
      metrics: [
        { label: "Layer", value: "wiki" },
        { label: "Anchors", value: "3" }
      ],
      sections: [
        {
          id: "chapters",
          title: "Chapters",
          body: "Key chapter map.",
          items: ["Overview", "Data flow"]
        },
        {
          id: "evidence",
          title: "Evidence",
          table: {
            columns: ["Path", "Note"],
            rows: [
              ["wiki/architecture.md", "source page"]
            ]
          }
        }
      ],
      raw: { path: "wiki/architecture.md", anchors: 3 }
    };

    render(<ArtifactShell artifact={artifact} />);

    expect(screen.getByRole("heading", { name: "Architecture explainer" })).toBeInTheDocument();
    expect(screen.getByText("A compact view of the architecture page.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Artifact metrics")).getByText("Layer")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Artifact table of contents")).getByRole("link", { name: "Chapters" })).toBeInTheDocument();
    expect(screen.getByText("Key chapter map.")).toBeInTheDocument();
    expect(screen.getAllByText("wiki/architecture.md").length).toBeGreaterThan(0);
    const raw = screen.getByText("Raw data").closest("details");
    expect(raw).not.toHaveAttribute("open");

    await userEvent.click(screen.getByRole("button", { name: "Copy as markdown" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("# Architecture explainer"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("## Chapters"));
  });
});
