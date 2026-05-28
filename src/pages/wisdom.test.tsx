import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WisdomPage } from "./WisdomPage";
import { createMockClient } from "../test/mockClient";

describe("WisdomPage interaction mock", () => {
  it("renders the directory tree with the first page selected in Read mode", async () => {
    const client = createMockClient();

    render(<WisdomPage client={client} />);

    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    expect(within(tree).getByText("delivery")).toBeInTheDocument();
    expect(within(tree).getByText("principles")).toBeInTheDocument();
    expect(within(tree).getByText("team")).toBeInTheDocument();

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    expect(within(reader).getByRole("tab", { name: "Read", selected: true })).toBeInTheDocument();
    expect(within(reader).getByRole("tab", { name: "Edit", selected: false })).toBeInTheDocument();
    // Initial backlink fixture is preserved.
    expect(within(reader).getByRole("button", { name: "Postmortem template" })).toBeInTheDocument();

    // No real API calls.
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("switches the reader when a different tree item is clicked", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "delivery" }));
    await userEvent.click(within(tree).getByRole("button", { name: /Release checklist/ }));

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    expect(within(reader).getByText("wisdom/delivery/release-checklist.md")).toBeInTheDocument();
    // Source from frontmatter shows on the right rail.
    expect(within(reader).getByText("sources/release/2026-04-release-notes.md")).toBeInTheDocument();
  });

  it("creates a new wisdom page via the New dialog and lands in Edit mode", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));

    const dialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Pair programming pact");
    await userEvent.type(within(dialog).getByLabelText("Slug"), "pair-programming-pact");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New" })).not.toBeInTheDocument();
    });

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    expect(within(reader).getByText("wisdom/pair-programming-pact.md")).toBeInTheDocument();
    expect(within(reader).getByRole("tab", { name: "Edit", selected: true })).toBeInTheDocument();
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("commits edits after the simulated save delay and returns to Read mode", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Always cite the source.");
    await userEvent.click(within(reader).getByRole("button", { name: "Save wisdom page" }));

    // Saving in flight: button reads "Saving…".
    expect(within(reader).getByRole("button", { name: "Save wisdom page" })).toHaveTextContent(/Saving/);

    await waitFor(
      () => {
        expect(within(reader).getByRole("tab", { name: "Read", selected: true })).toBeInTheDocument();
      },
      { timeout: 2500 }
    );
    expect(within(reader).getByText("Always cite the source.")).toBeInTheDocument();
  });

  it("inserts a K-layer wikilink at the textarea caret from the Add wikilink popover", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));

    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    const initialBody = textarea.value;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    await userEvent.click(within(reader).getByRole("button", { name: "Add wikilink" }));

    const popover = await screen.findByRole("dialog", { name: "Add wikilink" });
    // No layer tabs — single unified K/W picker, no per-tab split.
    expect(within(popover).queryByRole("tab")).not.toBeInTheDocument();
    await userEvent.type(within(popover).getByLabelText("Search K/W titles"), "knowledge graph");
    await userEvent.click(within(popover).getByRole("button", { name: /Knowledge graph/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add wikilink" })).not.toBeInTheDocument();
    });
    const updated = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    expect(updated.value).toBe(`${initialBody}[[Knowledge graph]]`);
  });

  it("inserts a W-layer wikilink (peer wisdom page) from the same Add wikilink popover", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));

    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    const initialBody = textarea.value;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    await userEvent.click(within(reader).getByRole("button", { name: "Add wikilink" }));

    const popover = await screen.findByRole("dialog", { name: "Add wikilink" });
    // The picker mixes K and W candidates — picking a peer wisdom page produces [[Title]].
    await userEvent.click(within(popover).getByRole("button", { name: /Team rituals/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add wikilink" })).not.toBeInTheDocument();
    });
    const updated = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    expect(updated.value).toBe(`${initialBody}[[Team rituals]]`);
  });

  it("attaches a D-layer source via the Add source shortcut", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));

    // The + button next to the Sources header opens the popover directly on D tab.
    const sourcesPane = within(reader).getByLabelText("Sources");
    await userEvent.click(within(sourcesPane).getByRole("button", { name: "Add source" }));

    const popover = await screen.findByRole("dialog", { name: "Add source" });
    // Single-purpose D picker — no layer tabs.
    expect(within(popover).queryByRole("tab")).not.toBeInTheDocument();
    await userEvent.click(within(popover).getByRole("button", { name: /LLM retrieval survey/ }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add source" })).not.toBeInTheDocument();
    });

    // The new path appears in the editor's Sources list, and × can remove it.
    const refreshedSources = within(reader).getByLabelText("Sources");
    expect(within(refreshedSources).getByText("sources/research/llm-retrieval-survey.md")).toBeInTheDocument();
    await userEvent.click(
      within(refreshedSources).getByRole("button", {
        name: "Remove source sources/research/llm-retrieval-survey.md"
      })
    );
    expect(
      within(refreshedSources).queryByText("sources/research/llm-retrieval-survey.md")
    ).not.toBeInTheDocument();
  });

  it("toggles favorite status from the reader header", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    // Initial page is "published" — star button advertises Add to favorites.
    const addButton = within(reader).getByRole("button", { name: "Add to favorites" });
    expect(addButton).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(addButton);

    const removeButton = within(reader).getByRole("button", { name: "Remove from favorites" });
    expect(removeButton).toHaveAttribute("aria-pressed", "true");
    // Status pill flips to favorite.
    expect(within(reader).getByText("favorite", { selector: ".status-pill" })).toBeInTheDocument();

    // Toggling again returns to published.
    await userEvent.click(removeButton);
    expect(within(reader).getByRole("button", { name: "Add to favorites" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(within(reader).getByText("published", { selector: ".status-pill" })).toBeInTheDocument();
  });

  it("filters the tree to favorites only via the Starred chip", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    // Team rituals is the only seed page with status=favorite.
    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    expect(within(tree).getByText("principles")).toBeInTheDocument();
    expect(within(tree).getByText("delivery")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Starred only/ }));

    // After filter, only the team/ branch with Team rituals remains.
    expect(within(tree).queryByText("principles")).not.toBeInTheDocument();
    expect(within(tree).queryByText("delivery")).not.toBeInTheDocument();
    expect(within(tree).getByText("team")).toBeInTheDocument();
  });

  it("preserves the lifecycle status across a favorite round-trip on a draft page", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    // Navigate to Team onboarding (status=draft).
    const tree = await screen.findByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "team" }));
    await userEvent.click(within(tree).getByRole("button", { name: /Team onboarding/ }));

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    expect(within(reader).getByText("draft", { selector: ".status-pill" })).toBeInTheDocument();

    // Star then un-star: lifecycle must return to "draft", not collapse to "published".
    await userEvent.click(within(reader).getByRole("button", { name: "Add to favorites" }));
    expect(within(reader).getByText("favorite", { selector: ".status-pill" })).toBeInTheDocument();
    await userEvent.click(within(reader).getByRole("button", { name: "Remove from favorites" }));
    expect(within(reader).getByText("draft", { selector: ".status-pill" })).toBeInTheDocument();
  });

  it("warns before creating a new page while edits are unsaved", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    // Dirty the current editor.
    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await userEvent.type(textarea, " — pending revision");

    // Open New + fill + Create.
    await userEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const dialog = await screen.findByRole("dialog", { name: "New" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Pair programming pact");
    await userEvent.type(within(dialog).getByLabelText("Slug"), "pair-programming-pact");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    // Unsaved-changes guard fires; New dialog stays mounted underneath so
    // canceling the discard prompt returns the user to their filled-in form.
    const alert = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(screen.getByRole("dialog", { name: "New" })).toBeInTheDocument();

    // Cancel keeps the user on the original dirty page and preserves the form.
    await userEvent.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
    expect(within(reader).queryByText("wisdom/pair-programming-pact.md")).not.toBeInTheDocument();
    const persistedDialog = screen.getByRole("dialog", { name: "New" });
    expect(within(persistedDialog).getByLabelText("Title")).toHaveValue("Pair programming pact");
  });

  it("warns before switching files while edits are unsaved", async () => {
    const client = createMockClient();
    render(<WisdomPage client={client} />);

    const reader = screen.getByRole("main", { name: "Wisdom reader" });
    await userEvent.click(within(reader).getByRole("tab", { name: "Edit" }));
    const textarea = within(reader).getByLabelText("Wisdom body") as HTMLTextAreaElement;
    await userEvent.type(textarea, " — extra thought");

    const tree = screen.getByRole("tree", { name: "Wisdom directory" });
    await userEvent.click(within(tree).getByRole("button", { name: "team" }));
    await userEvent.click(within(tree).getByRole("button", { name: /Team onboarding/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Discard unsaved changes?" });
    expect(within(dialog).getByText(/have not been saved/i)).toBeInTheDocument();

    // Cancel keeps us on the edited page.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(reader).getByText("wisdom/principles/prefer-evidence.md")).toBeInTheDocument();
  });
});
