import { beforeEach, describe, expect, it } from "vitest";
import { defaultServerUrl, loadConnection, serverKey, tokenKey } from "./connection";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("mb connection storage", () => {
  it("returns the default URL and an empty token when nothing is stored", () => {
    expect(loadConnection()).toEqual({ serverUrl: defaultServerUrl, token: "" });
  });

  it("reads the connection from localStorage (written by the workbench Settings page)", () => {
    localStorage.setItem(serverKey, "https://core.example");
    localStorage.setItem(tokenKey, "saved-token");
    expect(loadConnection()).toEqual({
      serverUrl: "https://core.example",
      token: "saved-token",
    });
  });

  it("recovers a cold-opened #MB-Web link in a fresh tab (sessionStorage empty)", () => {
    // localStorage is shared across tabs and survives a restart, so the
    // shareable link connects without a per-tab handoff. (This is why MB-Web no
    // longer needs its own settings panel — issue #97 follow-up.)
    localStorage.setItem(serverKey, "https://core.example");
    localStorage.setItem(tokenKey, "saved-token");
    sessionStorage.clear();
    expect(loadConnection()).toEqual({
      serverUrl: "https://core.example",
      token: "saved-token",
    });
  });

  it("falls back to the default URL but keeps a stored token", () => {
    localStorage.setItem(tokenKey, "tok-only");
    expect(loadConnection()).toEqual({ serverUrl: defaultServerUrl, token: "tok-only" });
  });
});
