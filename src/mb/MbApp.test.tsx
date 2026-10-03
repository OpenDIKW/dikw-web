import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MbApp } from "./MbApp";
import { AuthContext } from "@opendikw/web-ui/auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MbApp in auth mode (issue #200)", () => {
  it("reads core only through the same-origin proxy and keeps viewers read-only", async () => {
    // Leftovers from before auth mode was switched on must not be used.
    localStorage.setItem("dikw-web.serverUrl", "https://old-core.example.com");
    localStorage.setItem("dikw-web.token", "stale-browser-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      const body =
        path === "/v1/base/pages" ? [] : path === "/web/translate/health" ? { enabled: false } : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthContext.Provider value={{ enabled: true, user: { sub: "u-1" }, role: "viewer" }}>
        <MbApp />
      </AuthContext.Provider>,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
        expect.arrayContaining(["/v1/health", "/v1/base/pages?active=true"]),
      ),
    );
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).not.toContain("old-core");
      expect(JSON.stringify(init?.headers ?? {})).not.toContain("stale-browser-token");
    }
    expect(screen.queryByRole("button", { name: "上传论文" })).not.toBeInTheDocument();
  });
});
