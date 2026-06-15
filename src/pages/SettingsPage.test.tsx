import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { defaultServerUrl } from "../config/connection";

// SettingsPage is a controlled component: the parent (App) owns the committed
// connection and persists it on save/clear. This wrapper mirrors that so the
// tests exercise the real round-trip (draft → commit → props re-seed) instead
// of a frozen-props snapshot.
function renderControlled(initial: { serverUrl: string; token: string }) {
  const onSave = vi.fn();
  const onClear = vi.fn();

  function Harness() {
    const [serverUrl, setServerUrl] = useState(initial.serverUrl);
    const [token, setToken] = useState(initial.token);
    return (
      <SettingsPage
        locale="en"
        theme="system"
        resolvedTheme="light"
        serverUrl={serverUrl}
        token={token}
        onLocaleChange={vi.fn()}
        onThemeChange={vi.fn()}
        onSaveConnection={(url, tok) => {
          onSave(url, tok);
          setServerUrl(url);
          setToken(tok);
        }}
        onClearConnection={() => {
          onClear();
          setServerUrl(defaultServerUrl);
          setToken("");
        }}
      />
    );
  }

  render(<Harness />);
  return { onSave, onClear };
}

const save = () => screen.getByRole("button", { name: "Save" });

describe("SettingsPage — connection", () => {
  it("seeds the inputs from the committed connection", () => {
    renderControlled({ serverUrl: "https://core.example", token: "tok" });
    expect(screen.getByLabelText("Server URL")).toHaveValue("https://core.example");
  });

  it("keeps Save disabled until a field changes, then flags the unsaved edit", () => {
    renderControlled({ serverUrl: "https://core.example", token: "tok" });
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "https://new.example" },
    });
    expect(save()).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("commits the edited connection on Save and shows an inline confirmation", () => {
    const { onSave } = renderControlled({ serverUrl: "https://core.example", token: "tok" });
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "https://new.example" },
    });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "new-tok" } });
    fireEvent.click(save());

    expect(onSave).toHaveBeenCalledWith("https://new.example", "new-tok");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    // Back to a clean state once committed.
    expect(save()).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("coerces a blank Server URL back to the default on Save", () => {
    const { onSave } = renderControlled({ serverUrl: "https://core.example", token: "tok" });
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "   " } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith(defaultServerUrl, "tok");
  });

  it("trims a copy-pasted whitespace-padded token on Save", () => {
    const { onSave } = renderControlled({ serverUrl: "https://core.example", token: "" });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "  padded-token\n" } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith("https://core.example", "padded-token");
  });

  it("clears immediately: resets fields to default + empty and stays clean", () => {
    const { onClear } = renderControlled({ serverUrl: "https://core.example", token: "tok" });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalled();
    expect(screen.getByLabelText("Server URL")).toHaveValue(defaultServerUrl);
    expect(screen.getByLabelText("Token")).toHaveValue("");
    expect(save()).toBeDisabled();
  });

  it("no longer renders the connection subtitle", () => {
    renderControlled({ serverUrl: "https://core.example", token: "tok" });
    expect(
      screen.queryByText("Configure the dikw-core API address used by the web app and Agent."),
    ).not.toBeInTheDocument();
  });
});
