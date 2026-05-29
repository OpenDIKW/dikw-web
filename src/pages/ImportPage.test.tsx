import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportPage } from "./ImportPage";
import { createMockClient, type MockDikwClient } from "../test/mockClient";
import {
  PIPELINE_STORAGE_KEY,
  type PipelineState
} from "../state/import-pipeline";
import type {
  ApplyReport,
  FixProposal,
  ImportResponse,
  TaskEvent,
  TaskHandle
} from "../types";

/** Create a File whose ``webkitRelativePath`` matches the picker shape so
 *  ``computeProjectRelPath`` strips the top dir consistently with the input
 *  selection flow. */
function file(name: string, body: string): File {
  const f = new File([body], name.split("/").pop()!, { type: "text/markdown" });
  Object.defineProperty(f, "webkitRelativePath", {
    value: name,
    configurable: true
  });
  return f;
}

/** Helper: drive the hidden file input as if the user picked a file. */
function selectFile(input: HTMLInputElement, ...files: File[]): void {
  Object.defineProperty(input, "files", {
    value: files,
    configurable: true
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Helper: build a TaskEvent stream that yields a single ``final`` event with
 *  ``status: "succeeded"``. The orchestrator only inspects the final event so
 *  this is the shortest fixture that completes a stage. */
function succeededStream(): AsyncGenerator<TaskEvent> {
  return (async function* () {
    yield {
      type: "final",
      seq: 1,
      ts: new Date().toISOString(),
      status: "succeeded"
    } as TaskEvent;
  })();
}

function handle(taskId: string, op: string): TaskHandle {
  return {
    task_id: taskId,
    op,
    status: "running",
    created_at: new Date().toISOString(),
    links: {}
  };
}

function importResponse(overrides: Partial<ImportResponse> = {}): ImportResponse {
  return {
    import_id: "imp_test_1",
    files_count: 1,
    bytes: 4096,
    applied_at: new Date().toISOString(),
    committed: [0],
    rejected: [],
    ...overrides
  };
}

/** A small fixture of three proposals across two kinds. The ``proposal_id``s
 *  are stable so tests can target individual cards by ``data-testid``. */
function sampleProposals(): FixProposal[] {
  return [
    {
      proposal_id: "p1",
      issue_kind: "broken_wikilink",
      issue_path: "sources/a.md",
      issue_detail: "[[missing-page]] does not resolve",
      operations: [
        { kind: "update_page", path: "sources/a.md" }
      ],
      rationale: "Wikilink target was renamed in 2024-Q3.",
      source: "heuristic"
    },
    {
      proposal_id: "p2",
      issue_kind: "missing_provenance",
      issue_path: "sources/a.md",
      issue_detail: "frontmatter has no `provenance:` field",
      operations: [
        { kind: "reconcile_provenance", path: "sources/a.md" }
      ],
      rationale: "Provenance is required for wisdom linkage.",
      source: "heuristic"
    },
    {
      proposal_id: "p3",
      issue_kind: "missing_provenance",
      issue_path: "sources/b.md",
      issue_detail: "frontmatter has no `provenance:` field",
      operations: [
        { kind: "reconcile_provenance", path: "sources/b.md" }
      ],
      rationale: "Provenance is required for wisdom linkage.",
      source: "heuristic"
    }
  ];
}

function applyReport(overrides: Partial<ApplyReport> = {}): ApplyReport {
  return {
    applied: [
      { kind: "update_page", path: "sources/a.md" }
    ],
    skipped: [],
    knowledge_paths_changed: ["sources/a.md"],
    proposal_task_id: null,
    ...overrides
  };
}

/** Seed a non-idle pipeline state into sessionStorage so a mount picks it up
 *  through the lazy ``useState`` initializer. */
function seedPipeline(state: Partial<PipelineState> & { stage: PipelineState["stage"] }): void {
  sessionStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(state));
}

describe("ImportPage — idle picker", () => {
  it("renders the picker in idle state", () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);
    expect(screen.getByRole("heading", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByText("Choose files")).toBeInTheDocument();
    expect(screen.getByText("Choose folder")).toBeInTheDocument();
    expect(screen.getByTestId("import-dropzone")).toBeInTheDocument();
  });

  it("renders a localized title in zh-CN", () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="zh-CN" />);
    expect(screen.getByRole("heading", { name: "导入" })).toBeInTheDocument();
    // Friendly Chinese stage names are surfaced in the dropzone hint copy.
    expect(screen.getByText("选择文件")).toBeInTheDocument();
  });

  it("shows the preview panel after files are selected", async () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);

    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    selectFile(input, file("Vault/a.md", "Hello body without embeds.\n"));

    await waitFor(() => {
      expect(screen.getByTestId("import-preview")).toBeInTheDocument();
    });
    expect(screen.getByText("Ready to import")).toBeInTheDocument();
    expect(screen.getByTestId("import-start")).toBeEnabled();
    // Included list should carry the archive path of the markdown.
    const included = screen.getByTestId("import-included-list");
    expect(within(included).getByText("sources/a.md")).toBeInTheDocument();
  });

  it("surfaces skipped files in their own column with a reason tag", async () => {
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);

    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    selectFile(
      input,
      file("V/a.md", "Body text with no embeds.\n"),
      // .txt is not in MD_EXTENSIONS or ASSET_EXTENSIONS — ``scanFiles`` will
      // emit a ``unsupported_extension`` skipped entry.
      file("V/notes.txt", "Plain notes")
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-preview")).toBeInTheDocument();
    });
    const skipped = screen.getByTestId("import-skipped-list");
    expect(within(skipped).getByText("notes.txt")).toBeInTheDocument();
    expect(within(skipped).getByText("unsupported")).toBeInTheDocument();
  });
});

describe("ImportPage — pipeline resume", () => {
  it("resumes a persisted task stage on mount (the initial-save wipe bug regression)", async () => {
    // Seed storage as if the user refreshed mid-ingest. The state initializer
    // must read this BEFORE the first persistence effect fires, otherwise the
    // effect saves the default ``idle`` state and clobbers the task id.
    seedPipeline({ stage: "ingest", ingestTaskId: "resumed-ingest" });
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

    await waitFor(() => {
      expect(screen.getByTestId("import-pipeline")).toBeInTheDocument();
      expect(screen.getByText("resumed-ingest")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-cancel")).toBeInTheDocument();
    // Storage still carries the resumed state — it was not clobbered.
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toContain(
      "resumed-ingest"
    );
  });

  it("renders the resume banner with title and detail when picking up mid-pipeline", async () => {
    seedPipeline({ stage: "synth", synthTaskId: "resumed-synth" });
    const client = createMockClient();
    Object.assign(client, {
      streamTaskEvents: vi.fn(() =>
        (async function* () {
          await new Promise(() => {});
        })()
      )
    });
    render(<ImportPage client={client} locale="en" />);

    const banner = await screen.findByTestId("import-resume-banner");
    expect(within(banner).getByText("Resumed your import")).toBeInTheDocument();
    expect(within(banner).getByText(/picked up polling/i)).toBeInTheDocument();
    // Task id is rendered once — inside the banner only (not duplicated in
    // the active-stage card, since the banner already shows it).
    expect(screen.getAllByText("resumed-synth")).toHaveLength(1);
  });

  it("does NOT render the resume banner for a fresh in-session start", async () => {
    const client = createMockClient();
    Object.assign(client, {
      importBundle: vi.fn(() => new Promise(() => {})) // hang in upload
    });
    render(<ImportPage client={client} locale="en" />);

    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    selectFile(input, file("V/a.md", "Body text.\n"));
    const startBtn = await screen.findByTestId("import-start");
    await userEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-pipeline")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("import-resume-banner")).not.toBeInTheDocument();
  });

  it("transitions to uploading when Start is clicked", async () => {
    const client = createMockClient();
    let importInvoked = false;
    Object.assign(client, {
      importBundle: vi.fn(
        () =>
          new Promise(() => {
            importInvoked = true;
          })
      )
    });
    render(<ImportPage client={client} locale="en" />);
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    selectFile(input, file("V/a.md", "Body text.\n"));

    const startBtn = await screen.findByTestId("import-start");
    await userEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByTestId("import-pipeline")).toBeInTheDocument();
      expect(screen.getByText("Upload")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-cancel")).toBeInTheDocument();
    expect(importInvoked).toBe(true);
  });
});

describe("ImportPage — lint review", () => {
  /** Stand up the page in ``lint-review`` directly by seeding storage; this
   *  keeps the test focused on the review UI without sequencing four tasks. */
  function renderAtLintReview(): MockDikwClient {
    const proposals = sampleProposals();
    seedPipeline({
      stage: "lint-review",
      lintProposeTaskId: "t_propose_1",
      proposals,
      picked: proposals.map((_, i) => i),
      importResult: {
        import_id: "imp_1",
        files_count: 1,
        bytes: 4096,
        applied_at: "",
        committed: [0],
        rejected: []
      }
    });
    const client = createMockClient();
    render(<ImportPage client={client} locale="en" />);
    return client;
  }

  it("renders proposals grouped by issue kind", async () => {
    renderAtLintReview();
    await screen.findByTestId("import-lint-review");
    // Three cards, two issue-kind group pills.
    expect(screen.getByTestId("import-lint-card-p1")).toBeInTheDocument();
    expect(screen.getByTestId("import-lint-card-p2")).toBeInTheDocument();
    expect(screen.getByTestId("import-lint-card-p3")).toBeInTheDocument();
    expect(screen.getByText("Broken wiki link")).toBeInTheDocument();
    expect(screen.getByText("Missing provenance")).toBeInTheDocument();
    // Apply button starts with all proposals picked.
    expect(screen.getByTestId("import-lint-apply")).toHaveTextContent("Apply 3 / 3");
  });

  it("toggles proposals on/off and reflects count in the apply button", async () => {
    renderAtLintReview();
    const card = await screen.findByTestId("import-lint-card-p1");
    expect(card).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("import-lint-apply")).toHaveTextContent("Apply 2 / 3");
    expect(screen.getByTestId("import-lint-selected-count")).toHaveTextContent(
      "2 selected"
    );

    // "Select none" zeroes the selection and disables Apply.
    await userEvent.click(screen.getByTestId("import-lint-select-none"));
    expect(screen.getByTestId("import-lint-apply")).toBeDisabled();
    expect(screen.getByTestId("import-lint-apply")).toHaveTextContent("Apply 0 / 3");

    // "Select all" restores 3/3.
    await userEvent.click(screen.getByTestId("import-lint-select-all"));
    expect(screen.getByTestId("import-lint-apply")).toBeEnabled();
    expect(screen.getByTestId("import-lint-apply")).toHaveTextContent("Apply 3 / 3");
  });

  it("calls startLintApply with the picked indices and transitions to done", async () => {
    const client = renderAtLintReview();
    const startLintApply = vi.fn().mockResolvedValue(handle("t_apply_1", "lint.apply"));
    Object.assign(client, {
      startLintApply,
      streamTaskEvents: vi.fn(() => succeededStream()),
      getTaskResult: vi.fn().mockResolvedValue(applyReport())
    });

    // Deselect p2 so the picked list is [0, 2] — ordering matters for the
    // wire contract; the apply handler sorts ascending.
    await userEvent.click(screen.getByTestId("import-lint-card-p2"));
    await userEvent.click(screen.getByTestId("import-lint-apply"));

    await waitFor(() => {
      expect(startLintApply).toHaveBeenCalledTimes(1);
    });
    expect(startLintApply).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalTaskId: "t_propose_1",
        pick: [0, 2]
      }),
      expect.any(AbortSignal)
    );

    // Pipeline lands on the done state.
    await screen.findByTestId("import-done");
    expect(screen.queryByTestId("import-lint-review")).not.toBeInTheDocument();
  });

  it("skip-all jumps straight to done without invoking the server", async () => {
    const client = renderAtLintReview();
    const startLintApply = vi.fn();
    Object.assign(client, { startLintApply });

    await userEvent.click(screen.getByTestId("import-lint-skip-all"));
    await screen.findByTestId("import-done");
    expect(startLintApply).not.toHaveBeenCalled();
  });
});

describe("ImportPage — done summary", () => {
  function renderDone(extra: Partial<PipelineState> = {}): void {
    seedPipeline({
      stage: "done",
      importResult: importResponse({ committed: [0, 1, 2], bytes: 12345 }),
      applyReport: applyReport(),
      proposals: sampleProposals(),
      picked: [0, 1, 2],
      ...extra
    });
    render(<ImportPage client={createMockClient()} locale="en" />);
  }

  it("shows the done banner with both forward CTAs", async () => {
    renderDone();
    await screen.findByTestId("import-done");
    expect(screen.getByText("Import complete")).toBeInTheDocument();
    expect(
      screen.getByText("Your knowledge base has been updated")
    ).toBeInTheDocument();
    expect(screen.getByTestId("import-done-open-wiki")).toBeInTheDocument();
    expect(screen.getByTestId("import-done-open-graph")).toBeInTheDocument();
    expect(screen.getByTestId("import-restart")).toBeInTheDocument();
  });

  it("renders user-skipped lint count when fewer proposals were picked", async () => {
    const proposals = sampleProposals();
    renderDone({ proposals, picked: [0] }); // picked 1 of 3
    await screen.findByTestId("import-done");
    expect(screen.getByText("Skipped by you")).toBeInTheDocument();
    // dd value rendered next to the dt.
    const dt = screen.getByText("Skipped by you");
    const dd = dt.nextElementSibling;
    expect(dd?.textContent).toBe("2");
  });

  it("restart wipes state and returns the user to the idle picker", async () => {
    renderDone();
    await screen.findByTestId("import-done");

    await userEvent.click(screen.getByTestId("import-restart"));

    await waitFor(() => {
      expect(screen.queryByTestId("import-done")).not.toBeInTheDocument();
      expect(screen.getByTestId("import-dropzone")).toBeInTheDocument();
    });
    // Storage cleared so a refresh wouldn't bounce back to "done".
    expect(sessionStorage.getItem(PIPELINE_STORAGE_KEY)).toBeNull();
  });
});

describe("ImportPage — failure and cancel", () => {
  it("renders a Notice with a Start-a-new-import retry button on failure", async () => {
    seedPipeline({
      stage: "failed",
      error: { stage: "synth", message: "synth crashed", code: "internal" }
    });
    render(<ImportPage client={createMockClient()} locale="en" />);

    expect(await screen.findByText("Import failed")).toBeInTheDocument();
    expect(screen.getByText(/synth crashed/i)).toBeInTheDocument();
    // The retry path uses the same "Start a new import" copy as the done tail.
    expect(screen.getByText("Start a new import")).toBeInTheDocument();
  });

  it("renders a cancelled Notice on user-cancelled state", async () => {
    seedPipeline({
      stage: "cancelled",
      error: { stage: "ingest", message: "ingest cancelled by user" }
    });
    render(<ImportPage client={createMockClient()} locale="en" />);
    expect(await screen.findByText("Import cancelled")).toBeInTheDocument();
  });
});
