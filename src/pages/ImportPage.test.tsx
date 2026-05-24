import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportPage } from "./ImportPage";
import { createMockClient } from "../test/mockClient";
import { PIPELINE_STORAGE_KEY } from "../state/import-pipeline";

function file(name: string, body: string): File {
  const f = new File([body], name.split("/").pop()!, { type: "text/markdown" });
  Object.defineProperty(f, "webkitRelativePath", {
    value: name,
    configurable: true
  });
  return f;
}

describe("ImportPage", () => {
  it("renders the picker in idle state", () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);
    expect(screen.getByRole("heading", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByText("Choose files")).toBeInTheDocument();
    expect(screen.getByText("Choose folder")).toBeInTheDocument();
  });

  it("shows the preview panel after files are selected", async () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);

    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    const md = file("Vault/a.md", "Hello body without embeds.\n");
    // Programmatically inject the file list; userEvent.upload doesn't honour
    // webkitRelativePath, but our scanner needs it to be present.
    Object.defineProperty(input, "files", {
      value: [md],
      configurable: true
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByTestId("import-preview")).toBeInTheDocument();
    });
    expect(screen.getByText("Ready to import")).toBeInTheDocument();
    expect(screen.getByTestId("import-start")).toBeEnabled();
  });

  it("renders a localized title in zh-CN", () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="zh-CN" />);
    expect(screen.getByRole("heading", { name: "导入" })).toBeInTheDocument();
  });

  it("resumes a persisted task stage on mount (the initial-save wipe bug regression)", async () => {
    // Seed storage as if the user refreshed mid-ingest. The state initializer
    // must read this BEFORE the first persistence effect fires, otherwise the
    // effect saves the default ``idle`` state and clobbers the task id.
    sessionStorage.setItem(
      PIPELINE_STORAGE_KEY,
      JSON.stringify({ stage: "ingest", ingestTaskId: "resumed-ingest" })
    );
    const client = createMockClient();
    // Hang the stream so we can observe the resumed running state without
    // sequencing the rest of the pipeline.
    Object.assign(client, {
      streamTaskEvents: vi.fn(() =>
        (async function* () {
          await new Promise(() => {});
        })()
      )
    });
    render(<ImportPage client={client} locale="en" />);
    // Pipeline panel + cancel button appear, anchored to the persisted task id.
    await waitFor(() => {
      expect(screen.getByTestId("import-pipeline")).toBeInTheDocument();
      expect(screen.getByText("resumed-ingest")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-cancel")).toBeInTheDocument();
    // Storage still carries the resumed state — it was not clobbered.
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toContain("resumed-ingest");
  });

  it("transitions to uploading when Start is clicked", async () => {
    const client = createMockClient();
    // Force importBundle to hang so we can observe the in-flight state.
    let importResolved = false;
    Object.assign(client, {
      importBundle: vi.fn(
        () =>
          new Promise(() => {
            importResolved = true;
          })
      )
    });
    render(<ImportPage client={client} locale="en" />);
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    const md = file("V/a.md", "Body text.\n");
    Object.defineProperty(input, "files", {
      value: [md],
      configurable: true
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const startBtn = await screen.findByTestId("import-start");
    await userEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-pipeline")).toBeInTheDocument();
      expect(screen.getByText("Upload")).toBeInTheDocument();
    });
    // Cancel button should now be visible.
    expect(screen.getByTestId("import-cancel")).toBeInTheDocument();
    // The mocked importBundle should have been invoked.
    expect(importResolved).toBe(true);
  });
});
