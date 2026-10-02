import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, AuthProbeError, loadAuth, useCanEdit, type AuthState } from "./auth";

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loadAuth", () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("location", {
      ...window.location,
      assign,
      pathname: "/",
      search: "",
      hash: "#chat",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it("reports auth off when the server says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(200, { enabled: false })),
    );
    await expect(loadAuth()).resolves.toEqual({ enabled: false });
  });

  it("returns the signed-in user and role in auth mode", async () => {
    const me = {
      enabled: true,
      user: { sub: "u-1", name: "Ada", email: "ada@example.com" },
      role: "viewer",
    };
    const fetchMock = vi.fn(async () => respond(200, me));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadAuth()).resolves.toEqual(me);
    expect(fetchMock).toHaveBeenCalledWith("/web/auth/me", expect.anything());
  });

  // An auth-mode server always answers /web/auth/me with JSON (200 or 401), so
  // these can only come from a server that has no auth mode at all.
  it.each([
    ["an older server without the route", () => respond(404)],
    [
      "a static host's SPA fallback page",
      () =>
        new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    ],
  ])("reports auth off for %s", async (_label, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    await expect(loadAuth()).resolves.toEqual({ enabled: false });
  });

  // Anything else is "unknown", and unknown must not re-enable the browser-held
  // core connection (a stored token would then go straight to core).
  it.each([
    ["an unreachable server", () => Promise.reject(new TypeError("fetch failed"))],
    ["a server error", () => respond(502)],
    ["auth mode with an unusable role", () => respond(200, { enabled: true, role: "admin" })],
  ])("fails closed for %s", async (_label, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));
    await expect(loadAuth()).rejects.toBeInstanceOf(AuthProbeError);
  });

  it("fails closed when the probe stalls instead of blocking the first render", async () => {
    vi.useFakeTimers();
    try {
      const stalled = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );
      vi.stubGlobal("fetch", stalled);
      const auth = loadAuth();
      const settled = expect(auth).rejects.toBeInstanceOf(AuthProbeError);
      await vi.advanceTimersByTimeAsync(5000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a signed-out auth-mode user to login, returning to the current page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(401)),
    );
    void loadAuth();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/web/auth/login?returnTo=%2F%23chat"));
  });
});

describe("installUnauthorizedRedirect", () => {
  const assign = vi.fn();
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  // A fresh module per test: the "redirect only once" latch is module state.
  async function install(reply: (url: string) => Response) {
    vi.resetModules();
    const { installUnauthorizedRedirect } = await import("./auth");
    vi.stubGlobal("location", {
      ...window.location,
      assign,
      origin: "http://localhost:3000",
      href: "http://localhost:3000/#base",
      pathname: "/",
      search: "",
      hash: "#base",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => reply(String(input))),
    );
    installUnauthorizedRedirect();
  }

  it("redirects to login (once) when a guarded same-origin API answers 401", async () => {
    await install(() => respond(401));
    const first = await fetch("/v1/base/pages");
    await fetch("/agent/sessions");
    // The response still reaches the caller; the page just navigates away.
    expect(first.status).toBe(401);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/web/auth/login?returnTo=%2F%23base");
  });

  it.each([
    ["a non-401 error", "/v1/base/pages", 403],
    ["a 401 from another origin", "https://core.example.com/v1/health", 401],
    ["a 401 from a non-API path", "/config.json", 401],
  ])("leaves %s alone", async (_label, url, status) => {
    await install(() => respond(status));
    await fetch(url);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("useCanEdit", () => {
  function canEditWith(auth: AuthState): boolean {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AuthContext.Provider, { value: auth }, children);
    return renderHook(() => useCanEdit(), { wrapper }).result.current;
  }

  it("allows everything when auth is off", () => {
    expect(canEditWith({ enabled: false })).toBe(true);
  });

  it("allows editors and blocks viewers in auth mode", () => {
    const user = { sub: "u-1" };
    expect(canEditWith({ enabled: true, user, role: "editor" })).toBe(true);
    expect(canEditWith({ enabled: true, user, role: "viewer" })).toBe(false);
  });
});
