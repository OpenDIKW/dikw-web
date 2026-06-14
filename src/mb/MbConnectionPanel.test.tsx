import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MbConnectionPanel } from "./MbConnectionPanel";
import { defaultServerUrl } from "./connection";

function setup(overrides: Partial<Parameters<typeof MbConnectionPanel>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <MbConnectionPanel
      serverUrl="https://core.example"
      token="current-token"
      remember={false}
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSave, onClose };
}

describe("MbConnectionPanel", () => {
  it("seeds the inputs from the current connection", () => {
    setup();
    expect(screen.getByLabelText("Server URL")).toHaveValue("https://core.example");
    expect(screen.getByLabelText("在本机记住连接（含令牌）")).not.toBeChecked();
  });

  it("saves the edited URL, token, and remember flag", () => {
    const { onSave, onClose } = setup();
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "https://new.example" },
    });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByLabelText("在本机记住连接（含令牌）"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith({
      serverUrl: "https://new.example",
      token: "new-token",
      remember: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("coerces a blank Server URL back to the default on save", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: defaultServerUrl }));
  });

  it("cancels without saving", () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
