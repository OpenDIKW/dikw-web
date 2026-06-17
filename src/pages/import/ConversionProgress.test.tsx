import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversionProgress } from "./ConversionProgress";
import { translations } from "../../i18n";
import type { ConversionState } from "../../state/import-pipeline";

const copy = translations.en.pages.import;

/** A batch with one actively-converting row, one done, one failed — the three
 *  visual states the panel must distinguish. */
function conversionFixture(): ConversionState {
  const now = Date.now();
  return {
    inputOrder: ["sha-active", "sha-done", "sha-failed"],
    files: {
      "sha-active": {
        inputSha: "sha-active",
        fileName: "big.pdf",
        sizeBytes: 4_500_000,
        ext: ".pdf",
        substage: "uploading",
        startedAt: now - 5000,
      },
      "sha-done": {
        inputSha: "sha-done",
        fileName: "done.pdf",
        sizeBytes: 1024,
        ext: ".pdf",
        substage: "done",
        startedAt: now - 9000,
      },
      "sha-failed": {
        inputSha: "sha-failed",
        fileName: "bad.pdf",
        sizeBytes: 1024,
        ext: ".pdf",
        substage: "failed",
        error: { code: "mineru_api", message: "boom" },
      },
    },
  };
}

describe("ConversionProgress", () => {
  it("labels the long server wait as converting (not 'uploading')", () => {
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    // The misleading "uploading to mineru" is gone; the in-flight row reads as
    // a conversion in progress.
    expect(screen.getByText(/Converting on mineru/i)).toBeInTheDocument();
    expect(screen.queryByText(/uploading to mineru/i)).not.toBeInTheDocument();
  });

  it("shows an animated progress bar and a live elapsed timer only on active rows", () => {
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    // Exactly one row is actively converting → exactly one bar + one timer.
    expect(screen.getAllByTestId("conversion-bar")).toHaveLength(1);
    const elapsed = screen.getByTestId("conversion-elapsed");
    expect(elapsed.textContent).toMatch(/\d+s/);
  });

  it("surfaces a reassurance hint while work is in flight", () => {
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(screen.getByTestId("conversion-hint")).toHaveTextContent(/minute or two/i);
  });

  it("keeps the failed row's error and Skip affordance", () => {
    const onSkipFailed = vi.fn();
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={onSkipFailed}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    const failedRow = screen.getByText("bad.pdf").closest("li") as HTMLElement;
    // The failed row carries no progress bar.
    expect(within(failedRow).queryByTestId("conversion-bar")).toBeNull();
    within(failedRow).getByTestId("conversion-skip").click();
    expect(onSkipFailed).toHaveBeenCalledWith("sha-failed");
  });

  it("offers a Retry affordance on the failed row that re-runs that file", () => {
    const onRetryFailed = vi.fn();
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={vi.fn()}
        onRetryFailed={onRetryFailed}
      />,
    );
    const failedRow = screen.getByText("bad.pdf").closest("li") as HTMLElement;
    within(failedRow).getByTestId("conversion-retry").click();
    expect(onRetryFailed).toHaveBeenCalledWith("sha-failed");
  });

  it("shows Retry only on failed rows, not on done or in-flight rows", () => {
    render(
      <ConversionProgress
        copy={copy}
        conversion={conversionFixture()}
        onSkipFailed={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    // Exactly one row (the failed one) carries a Retry button.
    expect(screen.getAllByTestId("conversion-retry")).toHaveLength(1);
    const doneRow = screen.getByText("done.pdf").closest("li") as HTMLElement;
    const activeRow = screen.getByText("big.pdf").closest("li") as HTMLElement;
    expect(within(doneRow).queryByTestId("conversion-retry")).toBeNull();
    expect(within(activeRow).queryByTestId("conversion-retry")).toBeNull();
  });

  it("does not render a hint when nothing is in flight", () => {
    const allDone: ConversionState = {
      inputOrder: ["a"],
      files: {
        a: {
          inputSha: "a",
          fileName: "x.pdf",
          sizeBytes: 1,
          ext: ".pdf",
          substage: "done",
          startedAt: Date.now() - 1000,
        },
      },
    };
    render(
      <ConversionProgress
        copy={copy}
        conversion={allDone}
        onSkipFailed={vi.fn()}
        onRetryFailed={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("conversion-hint")).toBeNull();
    expect(screen.queryByTestId("conversion-bar")).toBeNull();
  });
});
