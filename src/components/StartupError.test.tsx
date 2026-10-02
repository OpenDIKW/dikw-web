import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeStorageKey, themeStorageKey } from "../i18n";
import { StartupError } from "./StartupError";

describe("StartupError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("explains the server can't be reached, in the stored locale and theme, and retries by reloading", () => {
    localStorage.setItem(localeStorageKey, "zh-CN");
    localStorage.setItem(themeStorageKey, "dark");
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    render(<StartupError />);

    expect(screen.getByText("无法连接服务器")).toBeInTheDocument();
    // The app never mounted, so nothing else applied the theme tokens.
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("defaults to English", () => {
    render(<StartupError />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
