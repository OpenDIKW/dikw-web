import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BilingualView, type BilingualBlock } from "./BilingualView";
import type { MarkdownContext } from "./markdown-runtime";

const ctx: MarkdownContext = { assets: [], assetBaseUrl: "", assetToken: "" };

const headProps = { sourceColHead: "原文", trColHead: "译文" };

function renderView(
  blocks: BilingualBlock[],
  extra: Partial<Parameters<typeof BilingualView>[0]> = {},
) {
  return render(
    <BilingualView blocks={blocks} ctx={ctx} translating={false} {...headProps} {...extra} />,
  );
}

describe("BilingualView", () => {
  it("pairs text blocks into source + translation columns and centers special blocks once", () => {
    renderView([
      { kind: "text", source: "## DIKW", translation: "## DIKW" },
      { kind: "text", source: "Hello world.", translation: "你好世界。" },
      { kind: "special", source: "```bash\ndikw ingest\n```" },
    ]);

    expect(document.querySelectorAll(".bi-pair:not(.bi-pair--special)")).toHaveLength(2);
    expect(document.querySelectorAll(".bi-pair--special")).toHaveLength(1);

    const src = document.querySelector(".bi-block--src");
    const tr = document.querySelector(".bi-block--tr");
    expect(src?.textContent).toContain("DIKW");
    expect(tr?.textContent).toContain("DIKW");

    // The code fence is a single shared instance, not duplicated per column.
    expect(document.querySelectorAll(".code-block")).toHaveLength(1);
    expect(screen.getByText("dikw ingest")).toBeInTheDocument();
  });

  it("namespaces translated-column heading ids so they cannot collide with the source", () => {
    renderView([{ kind: "text", source: "## DIKW", translation: "## DIKW" }]);
    const srcHeading = document.querySelector(".bi-block--src h2");
    const trHeading = document.querySelector(".bi-block--tr h2");
    expect(srcHeading?.id).toBe("dikw");
    expect(trHeading?.id).toBe("tr-dikw");
  });

  it("renders column headers from the supplied labels", () => {
    renderView([{ kind: "text", source: "x", translation: "y" }]);
    expect(screen.getByText("原文")).toBeInTheDocument();
    expect(screen.getByText("译文")).toBeInTheDocument();
  });

  it("shows skeletons on text pairs while translating", () => {
    renderView([{ kind: "text", source: "Hello.", translation: undefined }], { translating: true });
    expect(document.querySelector(".bi-pair.is-loading")).not.toBeNull();
    expect(document.querySelector(".bi-skeleton")).not.toBeNull();
  });

  it("reveals each text pair independently as its translation arrives", () => {
    // Mid-flight: block 0 is translated, block 1 is not. Only the pending pair
    // should carry the loading skeleton — not the whole document.
    renderView(
      [
        { kind: "text", source: "Done.", translation: "完成。" },
        { kind: "text", source: "Pending.", translation: undefined },
      ],
      { translating: true },
    );
    const pairs = document.querySelectorAll(".bi-pair:not(.bi-pair--special)");
    expect(pairs).toHaveLength(2);
    expect(pairs[0].classList.contains("is-loading")).toBe(false);
    expect(pairs[1].classList.contains("is-loading")).toBe(true);
    expect(pairs[0].querySelector(".bi-tr-text")?.textContent).toContain("完成。");
  });

  it("drops the loading state and shows translated text once translations arrive", () => {
    renderView([{ kind: "text", source: "Hello.", translation: "你好。" }], { translating: false });
    expect(document.querySelector(".bi-pair.is-loading")).toBeNull();
    expect(document.querySelector(".bi-block--tr .bi-tr-text")?.textContent).toContain("你好。");
  });

  it("reports the clicked side for wikilinks (source vs translation column)", async () => {
    const onWikiLink = vi.fn();
    renderView(
      [{ kind: "text", source: "See [[notes|the notes]].", translation: "见[[notes|笔记]]。" }],
      { onWikiLink },
    );

    const srcLink = document.querySelector<HTMLButtonElement>(".bi-block--src .inline-wikilink");
    const trLink = document.querySelector<HTMLButtonElement>(".bi-block--tr .inline-wikilink");
    expect(srcLink).not.toBeNull();
    expect(trLink).not.toBeNull();

    await userEvent.click(srcLink!);
    expect(onWikiLink).toHaveBeenLastCalledWith("notes", "src");

    await userEvent.click(trLink!);
    expect(onWikiLink).toHaveBeenLastCalledWith("notes", "tr");
  });
});
