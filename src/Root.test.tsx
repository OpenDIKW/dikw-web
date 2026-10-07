import { render, screen } from "@testing-library/react";
import { loadAuth } from "@opendikw/web-ui/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBranding } from "./config/branding";
import { Root } from "./Root";

vi.mock("./App", () => ({ App: () => <h1>Workbench</h1> }));
vi.mock("./migrations/LegacyMbMigration", () => ({
  LegacyMbMigration: () => <h1>Legacy backup</h1>,
}));
vi.mock("@opendikw/web-ui/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opendikw/web-ui/auth")>()),
  loadAuth: vi.fn(),
}));

function at(hash: string) {
  const reload = vi.fn();
  const location = { ...window.location, hash, reload };
  vi.stubGlobal("location", location);
  return location;
}

describe("Root", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(loadAuth).mockReset();
  });

  it("fails closed: an unavailable auth probe shows the startup error, not the workbench", async () => {
    at("#overview");
    vi.mocked(loadAuth).mockRejectedValue(new Error("probe timed out"));

    render(<Root startupBranding={Promise.resolve(defaultBranding)} />);

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Workbench" })).not.toBeInTheDocument();
  });

  it("mounts the legacy entry without the auth probe and reloads to leave it", async () => {
    const location = at("#/MB-Web");

    render(<Root startupBranding={Promise.resolve(defaultBranding)} />);

    expect(await screen.findByRole("heading", { name: "Legacy backup" })).toBeInTheDocument();
    expect(loadAuth).not.toHaveBeenCalled();
    location.hash = "#overview";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
