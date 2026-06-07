import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WisdomPage } from "./WisdomPage";
import { createMockClient, type MockDikwClient } from "../test/mockClient";
import { WISDOM_WRITE_STORAGE_KEY } from "../state/wisdom-write";

// ── fixtures ──────────────────────────────────────────────────────────────

interface ListRow {
  doc_id: string;
  path: string;
  title: string;
  hash: string;
  mtime: number;
  layer: "wisdom";
  active: boolean;
  status: "draft" | "published" | "favorite" | "archived";
}

const baseList: ListRow[] = [
  {
    doc_id: "doc-prefer",
    path: "wisdom/principles/prefer-evidence.md",
    title: "Prefer evidence",
    hash: "h1",
    mtime: 1746000000,
    layer: "wisdom",
    active: true,
    status: "published",
  },
  {
    doc_id: "doc-release",
    path: "wisdom/delivery/release-checklist.md",
    title: "Release checklist",
    hash: "h2",
    mtime: 1746000100,
    layer: "wisdom",
    active: true,
    status: "favorite",
  },
  {
    doc_id: "doc-onboarding",
    path: "wisdom/team/onboarding.md",
    title: "Team onboarding",
    hash: "h3",
    mtime: 1746000200,
    layer: "wisdom",
    active: true,
    status: "draft",
  },
];

const baseBodies: Record<string, string> = {
  "wisdom/principles/prefer-evidence.md": "When in doubt, run the experiment.",
  "wisdom/delivery/release-checklist.md": "Cut a release branch before the freeze.",
  "wisdom/team/onboarding.md": "Pair new hires with a buddy for two weeks.",
};

const baseFrontmatter: Record<string, Record<string, unknown>> = {
  "wisdom/delivery/release-checklist.md": {
    title: "Release checklist",
    status: "favorite",
    sources: ["sources/release/2026-04-release-notes.md"],
  },
};

const baseLinks: Record<
  string,
  Array<{ src_path: string; src_doc_id: string; link_type: "wikilink" }>
> = {
  "wisdom/principles/prefer-evidence.md": [
    {
      src_path: "wisdom/delivery/release-checklist.md",
      src_doc_id: "doc-release",
      link_type: "wikilink",
    },
  ],
};

const kCandidatesFixture = [
  {
    doc_id: "k-dikw",
    path: "knowledge/concepts/dikw-layered-model.md",
    title: "DIKW layered model",
    mtime: 1745000000,
    layer: "knowledge" as const,
    active: true,
  },
  {
    doc_id: "k-postmortem",
    path: "knowledge/templates/postmortem.md",
    title: "Postmortem template",
    mtime: 1745000100,
    layer: "knowledge" as const,
    active: true,
  },
];

const dCandidatesFixture = [
  {
    doc_id: "d-release-notes",
    path: "sources/release/2026-04-release-notes.md",
    title: "2026-04 release notes",
    mtime: 1740000000,
    layer: "source" as const,
    active: true,
  },
];

// ── helpers ───────────────────────────────────────────────────────────────

interface SetupOptions {
  writeFails?: boolean;
  coreId?: string;
}

function setupClient(opts: SetupOptions = {}): MockDikwClient {
  const client = createMockClient(opts.coreId);
  // Local copies so each test gets a fresh mutable state and reloads pick up
  // POST-induced changes.
  const listState: ListRow[] = baseList.map((row) => ({ ...row }));
  const bodies: Record<string, string> = { ...baseBodies };
  const frontmatter: Record<string, Record<string, unknown>> = JSON.parse(
    JSON.stringify(baseFrontmatter),
  );
  const pendingResults = new Map<string, Record<string, unknown>>();

  client.get.mockImplementation((path: string, options?: { params?: Record<string, unknown> }) => {
    if (path === "/v1/base/pages") {
      const layer = options?.params?.layer;
      if (layer === "wisdom") return Promise.resolve(listState.map((row) => ({ ...row })));
      if (layer === "knowledge") return Promise.resolve(kCandidatesFixture);
      if (layer === "source") return Promise.resolve(dCandidatesFixture);
      return Promise.resolve([]);
    }
    const detailMatch = /^\/v1\/base\/pages\/(.+?)(?:\/(links|provenance))?$/.exec(path);
    if (detailMatch) {
      const targetPath = detailMatch[1];
      const sub = detailMatch[2];
      if (sub === "links") {
        return Promise.resolve({
          path: targetPath,
          outgoing: [],
          incoming: baseLinks[targetPath] ?? [],
        });
      }
      if (sub === "provenance") {
        return Promise.resolve({ path: targetPath, derived_from: [], derived_pages: [] });
      }
      return Promise.resolve({
        doc_id: `doc-${targetPath}`,
        path: targetPath,
        layer: "wisdom",
        title: listState.find((row) => row.path === targetPath)?.title ?? null,
        body: bodies[targetPath] ?? "",
        anchors: [],
        assets: [],
        frontmatter: frontmatter[targetPath] ?? {},
      });
    }
    return Promise.reject(new Error(`unmocked GET ${path}`));
  });

  client.post.mockImplementation(
    (
      path: string,
      body: {
        slug: string;
        title: string;
        body: string;
        author?: string;
        status?: "draft" | "published" | "favorite" | "archived";
        sources?: string[];
      },
    ) => {
      if (path === "/v1/base/wisdom") {
        const resolvedPath = body.author
          ? `wisdom/${body.author}/${body.slug}.md`
          : `wisdom/${body.slug}.md`;
        // Apply the write so subsequent GETs reflect it.
        const idx = listState.findIndex((row) => row.path === resolvedPath);
        const updatedRow: ListRow = {
          doc_id: idx >= 0 ? listState[idx].doc_id : `doc-${body.slug}`,
          path: resolvedPath,
          title: body.title,
          hash: "deadbeef",
          mtime: Math.floor(Date.now() / 1000),
          layer: "wisdom",
          active: true,
          status: body.status ?? "published",
        };
        if (idx >= 0) listState[idx] = updatedRow;
        else listState.push(updatedRow);
        bodies[resolvedPath] = body.body;
        frontmatter[resolvedPath] = {
          title: body.title,
          status: body.status ?? "published",
          sources: body.sources ?? [],
        };

        const taskId = `task-${body.slug}-${listState.length}`;
        pendingResults.set(taskId, {
          path: resolvedPath,
          created: idx < 0,
          hash: "deadbeef",
          chunks: 1,
          embedded: body.body.length,
          unresolved_wikilinks: 0,
        });
        return Promise.resolve({
          task_id: taskId,
          op: "wisdom.write",
          status: "running",
          created_at: "2026-05-28T00:00:00.000Z",
        });
      }
      return Promise.reject(new Error(`unmocked POST ${path}`));
    },
  );

  client.streamTaskEvents.mockImplementation(async function* () {
    return;
  });

  client.getTaskResult.mockImplementation((taskId: string) => {
    if (opts.writeFails) {
      return Promise.reject(new Error("simulated task failure"));
    }
    const cached = pendingResults.get(taskId);
    if (cached) {
      pendingResults.delete(taskId);
      return Promise.resolve(cached);
    }
    return Promise.resolve({
      path: "wisdom/unknown.md",
      created: false,
      hash: "x",
      chunks: 0,
      embedded: 0,
      unresolved_wikilinks: 0,
    });
  });

  return client;
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("WisdomPage backed by dikw-core API", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("renders the wisdom list and selects the first page in Read mode", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);

    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    expect(within(tree).getByText("delivery")).toBeInTheDocument();
    expect(within(tree).getByText("principles")).toBeInTheDocument();
    expect(within(tree).getByText("team")).toBeInTheDocument();

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    expect(within(reader).getByRole("tab", { name: "Read", selected: true })).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith(
      "/v1/base/pages",
      expect.objectContaining({ params: expect.objectContaining({ layer: "wisdom" }) }),
    );
  });

  it("loads body + frontmatter sources when switching to another tree item", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);

    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "delivery" }));
    await userEvent.click(within(tree).getByRole("button", { name: /Release checklist/ }));

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/delivery/release-checklist.md")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(reader).getByText("sources/release/2026-04-release-notes.md"),
      ).toBeInTheDocument();
    });
  });

  it("creates a pending draft via the New dialog without calling the API yet", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    await screen.findByRole("tree", { name: "Wisdom directory" });

    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const dialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Pair programming pact");
    await userEvent.type(within(dialog).getByLabelText("Slug"), "pair-programming-pact");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByRole("tab", { name: "Edit", selected: true })).toBeInTheDocument();
    });
    expect(within(reader).getByText(/Unsaved draft/)).toBeInTheDocument();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("POSTs to /v1/base/wisdom on Save and returns to Read mode after terminal", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });

    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain("run the experiment"));
    await userEvent.type(textarea, " Always.");

    await userEvent.click(within(reader).getByRole("button", { name: "Save wisdom page" }));

    await waitFor(() => {
      expect(client.post).toHaveBeenCalledWith(
        "/v1/base/wisdom",
        expect.objectContaining({
          slug: "prefer-evidence",
          body: expect.stringContaining("Always."),
        }),
        expect.any(Object),
      );
    });
    // After the simulated task completes and the list reload, the reader
    // returns to Read mode showing the same page (path may be re-rendered).
    await waitFor(
      () => {
        expect(
          within(reader).getByRole("tab", { name: "Read", selected: true }),
        ).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it("merges K + W candidates in Add wikilink and excludes the current page", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });

    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    await userEvent.click(within(reader).getByRole("button", { name: "Add wikilink" }));

    const popover = await screen.findByRole("dialog", { name: "Add wikilink" });
    await waitFor(() => {
      expect(within(popover).getByText("DIKW layered model")).toBeInTheDocument();
    });
    expect(within(popover).getByText("Release checklist")).toBeInTheDocument();
    expect(within(popover).queryByText("Prefer evidence")).not.toBeInTheDocument();
  });

  it("attaches a D-layer source via Add source picker", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    await userEvent.click(within(reader).getByRole("button", { name: "Add source" }));

    const popover = await screen.findByRole("dialog", { name: "Add source" });
    await waitFor(() => {
      expect(within(popover).getByText("2026-04 release notes")).toBeInTheDocument();
    });
    await userEvent.click(within(popover).getByText("2026-04 release notes"));

    await waitFor(() => {
      expect(
        within(reader).getByText("sources/release/2026-04-release-notes.md"),
      ).toBeInTheDocument();
    });
  });

  it("favorite toggle POSTs with status=favorite + no_embed=true", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });

    const star = await within(reader).findByRole("button", { name: "Add to favorites" });
    await waitFor(() => expect(star).toBeEnabled());

    await userEvent.click(star);

    await waitFor(() => {
      expect(client.post).toHaveBeenCalledWith(
        "/v1/base/wisdom",
        expect.objectContaining({ status: "favorite", no_embed: true }),
        expect.any(Object),
      );
    });
  });

  it("filters the tree to favorites only via the Starred chip", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    // Expand all folders so child files are visible for the filter assertion.
    await userEvent.click(within(tree).getByRole("button", { name: "team" }));
    await userEvent.click(within(tree).getByRole("button", { name: "delivery" }));
    expect(within(tree).getByRole("button", { name: /Team onboarding/ })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: /Release checklist/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Starred only/ }));
    await waitFor(() => {
      expect(
        within(tree).queryByRole("button", { name: /Team onboarding/ }),
      ).not.toBeInTheDocument();
    });
    // Release checklist (status=favorite) survives the filter.
    expect(within(tree).getByRole("button", { name: /Release checklist/ })).toBeInTheDocument();
  });

  it("warns before creating a new page while edits are unsaved", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value.length).toBeGreaterThan(0));
    await userEvent.type(textarea, " — extra");

    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const newDialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(newDialog).getByLabelText("Title"), "Pair programming pact");
    await userEvent.type(within(newDialog).getByLabelText("Slug"), "pair-programming-pact");
    await userEvent.click(within(newDialog).getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    await userEvent.click(within(alert).getByRole("button", { name: "Cancel" }));
    const persistedDialog = screen.getByRole("dialog", { name: "New" });
    expect(within(persistedDialog).getByLabelText("Title")).toHaveValue("Pair programming pact");
  });

  it("warns before switching files while edits are unsaved", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value.length).toBeGreaterThan(0));
    await userEvent.type(textarea, " — extra");

    const tree = screen.getByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "team" }));
    await userEvent.click(within(tree).getByRole("button", { name: /Team onboarding/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
  });

  it("warns before collapsing a folder that contains a dirty page", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value.length).toBeGreaterThan(0));
    await userEvent.type(textarea, " — collapse me");

    const tree = screen.getByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "principles" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
  });

  it("resumes a previously started save when sessionStorage has a task_id", async () => {
    sessionStorage.setItem(
      WISDOM_WRITE_STORAGE_KEY,
      JSON.stringify({
        taskId: "task-resume-1",
        targetPath: "wisdom/principles/prefer-evidence.md",
        slug: "prefer-evidence",
        scope: "edit",
        coreUrl: "",
      }),
    );

    const client = setupClient();
    client.getTaskResult.mockResolvedValueOnce({
      path: "wisdom/principles/prefer-evidence.md",
      created: false,
      hash: "h1",
      chunks: 1,
      embedded: 1,
      unresolved_wikilinks: 0,
    });

    render(<WisdomPage client={client} />);

    await waitFor(() => {
      expect(client.streamTaskEvents).toHaveBeenCalledWith(
        "task-resume-1",
        0,
        expect.any(AbortSignal),
      );
    });
    await waitFor(() => {
      expect(sessionStorage.getItem(WISDOM_WRITE_STORAGE_KEY)).toBeNull();
    });
  });

  it("blocks Edit until the body detail has loaded", async () => {
    const client = setupClient();
    let resolveDetail: ((value: unknown) => void) | null = null;
    // Override the body fetch for prefer-evidence to hang until we release it.
    client.get.mockImplementation(
      (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path === "/v1/base/pages" && options?.params?.layer === "wisdom") {
          return Promise.resolve(baseList.map((row) => ({ ...row })));
        }
        if (path === "/v1/base/pages/wisdom/principles/prefer-evidence.md") {
          return new Promise((resolve) => {
            resolveDetail = resolve;
          });
        }
        if (/\/v1\/base\/pages\/.+?\/links$/.test(path)) {
          return Promise.resolve({ path: "x", outgoing: [], incoming: [] });
        }
        return Promise.resolve({});
      },
    );

    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    // Path shows up from the list row; body fetch is still pending.
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    // Edit must NOT have switched — Read stays selected, toast shows.
    expect(within(reader).getByRole("tab", { name: "Read", selected: true })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(reader).getByText(/Loading page contents/)).toBeInTheDocument();
    });

    // Release the body fetch; Edit now opens normally.
    (resolveDetail as ((value: unknown) => void) | null)?.({
      doc_id: "doc-prefer",
      path: "wisdom/principles/prefer-evidence.md",
      layer: "wisdom",
      title: "Prefer evidence",
      body: "Real body",
      anchors: [],
      assets: [],
      frontmatter: {},
    });
    await waitFor(() => {
      expect(
        (within(reader).queryByLabelText("Wisdom body") as HTMLTextAreaElement | null)?.value ?? "",
      ).toBeFalsy(); // body loaded but Edit not yet entered
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    await waitFor(() => {
      expect(within(reader).getByLabelText("Wisdom body")).toHaveValue("Real body");
    });
  });

  it("filters incoming links to wisdom-layer paths only", async () => {
    const client = setupClient();
    client.get.mockImplementation(
      (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path === "/v1/base/pages" && options?.params?.layer === "wisdom") {
          return Promise.resolve(baseList.map((row) => ({ ...row })));
        }
        if (path === "/v1/base/pages/wisdom/principles/prefer-evidence.md") {
          return Promise.resolve({
            doc_id: "doc-prefer",
            path: "wisdom/principles/prefer-evidence.md",
            layer: "wisdom",
            title: "Prefer evidence",
            body: "Body.",
            anchors: [],
            assets: [],
            frontmatter: {},
          });
        }
        if (path === "/v1/base/pages/wisdom/principles/prefer-evidence.md/links") {
          return Promise.resolve({
            path: "wisdom/principles/prefer-evidence.md",
            outgoing: [],
            incoming: [
              {
                src_path: "knowledge/concepts/postmortem.md",
                src_doc_id: "k-1",
                link_type: "wikilink",
              },
              {
                src_path: "wisdom/delivery/release-checklist.md",
                src_doc_id: "doc-release",
                link_type: "wikilink",
              },
            ],
          });
        }
        return Promise.resolve({});
      },
    );

    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    // Wisdom backlink appears in the aside; the K-layer one is filtered out.
    await waitFor(() => {
      expect(within(reader).getByRole("button", { name: "Release checklist" })).toBeInTheDocument();
    });
    expect(within(reader).queryByText("knowledge/concepts/postmortem.md")).not.toBeInTheDocument();
  });

  it("disables the star while edits are dirty so favorite can't drop the draft", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value.length).toBeGreaterThan(0));
    await userEvent.type(textarea, " — extra");

    const star = within(reader).getByRole("button", { name: "Add to favorites" });
    expect(star).toBeDisabled();
  });

  it("echoes custom frontmatter extras back via WisdomWriteSubmit.extras on Save", async () => {
    const client = setupClient();
    // Override the detail fetch to return a page with custom frontmatter keys.
    client.get.mockImplementation(
      (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path === "/v1/base/pages" && options?.params?.layer === "wisdom") {
          return Promise.resolve(baseList.map((row) => ({ ...row })));
        }
        if (path === "/v1/base/pages/wisdom/principles/prefer-evidence.md") {
          return Promise.resolve({
            doc_id: "doc-prefer",
            path: "wisdom/principles/prefer-evidence.md",
            layer: "wisdom",
            title: "Prefer evidence",
            body: "Body.",
            anchors: [],
            assets: [],
            frontmatter: {
              title: "Prefer evidence",
              aliases: ["evidence-first"],
              review_due: "2026-12",
            },
          });
        }
        if (/\/v1\/base\/pages\/.+?\/links$/.test(path)) {
          return Promise.resolve({ path: "x", outgoing: [], incoming: [] });
        }
        return Promise.resolve({});
      },
    );

    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain("Body."));
    await userEvent.type(textarea, " More.");
    await userEvent.click(within(reader).getByRole("button", { name: "Save wisdom page" }));

    await waitFor(() => {
      expect(client.post).toHaveBeenCalledWith(
        "/v1/base/wisdom",
        expect.objectContaining({
          extras: expect.objectContaining({ aliases: ["evidence-first"], review_due: "2026-12" }),
        }),
        expect.any(Object),
      );
    });
  });

  it("blocks New + Save while the wisdom list is still loading", async () => {
    const client = setupClient();
    let resolveList: ((value: unknown) => void) | null = null;
    client.get.mockImplementation(
      (path: string, options?: { params?: Record<string, unknown> }) => {
        if (path === "/v1/base/pages" && options?.params?.layer === "wisdom") {
          return new Promise((resolve) => {
            resolveList = resolve;
          });
        }
        return Promise.resolve({});
      },
    );

    render(<WisdomPage client={client} />);
    // Open New without the list loaded yet.
    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const dialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Race draft");
    await userEvent.type(within(dialog).getByLabelText("Slug"), "race-draft");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    // Error surfaces in the dialog; no POST attempted.
    await waitFor(() => {
      expect(within(dialog).getByText(/Page list still loading/)).toBeInTheDocument();
    });
    expect(client.post).not.toHaveBeenCalled();

    // Resolve the list to unblock cleanup.
    (resolveList as ((value: unknown) => void) | null)?.([]);
  });

  it("auto-expands the (pending) folder so the new draft is visible", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    await screen.findByRole("tree", { name: "Wisdom directory" });

    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const dialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Visible draft");
    await userEvent.type(within(dialog).getByLabelText("Slug"), "visible-draft");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    const tree = screen.getByRole("tree", { name: "Wisdom directory" });
    // The pending folder must be expanded automatically and its child file
    // visible so the user actually sees the row they just created.
    await waitFor(() => {
      expect(within(tree).getByRole("button", { name: /Visible draft/ })).toBeInTheDocument();
    });
  });

  it("rolls back the optimistic favorite if the write task fails", async () => {
    const client = setupClient({ writeFails: true });
    render(<WisdomPage client={client} />);
    const reader = await screen.findByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });
    const star = await within(reader).findByRole("button", { name: "Add to favorites" });
    await waitFor(() => expect(star).toBeEnabled());

    await userEvent.click(star);

    // After failure the star reverts.
    await waitFor(() => {
      expect(within(reader).getByRole("button", { name: "Add to favorites" })).toBeInTheDocument();
    });
  });

  it("resets pages, selection and mode when the client coreId changes", async () => {
    const clientA = setupClient({ coreId: "core-a" });
    const { rerender } = render(<WisdomPage client={clientA} />);

    // Wait for clientA's wisdom list to render with its default selection.
    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    });

    // Build a second client representing a different core that returns an
    // empty wisdom list. The reset effect must clear clientA's selection so
    // we don't continue to address clientA's path against the new client.
    const clientB = createMockClient("core-b");
    clientB.get.mockImplementation((path: string) => {
      if (path === "/v1/base/pages") return Promise.resolve([]);
      return Promise.reject(new Error(`unmocked GET ${path}`));
    });

    rerender(<WisdomPage client={clientB} />);

    // The old selection's heading must no longer appear, and no detail fetch
    // against clientB should have been issued for the stale path.
    await waitFor(() => {
      expect(
        within(reader).queryByText("wisdom/principles/prefer-evidence.md"),
      ).not.toBeInTheDocument();
    });
    expect(clientB.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/base/pages/wisdom/principles/prefer-evidence.md"),
      expect.anything(),
    );
  });

  it("refuses to Save an empty body and shows a toast", async () => {
    const client = setupClient();
    render(<WisdomPage client={client} />);
    await screen.findByRole("tree", { name: "Wisdom directory" });

    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const newDialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(newDialog).getByLabelText("Title"), "Empty draft");
    await userEvent.type(within(newDialog).getByLabelText("Slug"), "empty-draft");
    await userEvent.click(within(newDialog).getByRole("button", { name: "Create" }));

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await waitFor(() => {
      expect(within(reader).getByRole("tab", { name: "Edit", selected: true })).toBeInTheDocument();
    });
    await userEvent.click(within(reader).getByRole("button", { name: "Save wisdom page" }));

    expect(client.post).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(within(reader).getByText(/Body cannot be empty/)).toBeInTheDocument();
    });
  });
});
