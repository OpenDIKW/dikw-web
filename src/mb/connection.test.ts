import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultServerUrl,
  loadConnection,
  rememberKey,
  saveConnection,
  serverKey,
  tokenKey,
} from "./connection";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("mb connection storage", () => {
  it("returns the default URL, empty token, remember=false when nothing is stored", () => {
    expect(loadConnection()).toEqual({
      serverUrl: defaultServerUrl,
      token: "",
      remember: false,
    });
  });

  it("reads the live tab's sessionStorage first (shared with the workbench App)", () => {
    sessionStorage.setItem(serverKey, "https://core.example");
    sessionStorage.setItem(tokenKey, "sess-token");
    expect(loadConnection()).toEqual({
      serverUrl: "https://core.example",
      token: "sess-token",
      remember: false,
    });
  });

  it("falls back to remembered localStorage when the tab's sessionStorage is empty (cold-open)", () => {
    localStorage.setItem(serverKey, "https://remembered.example");
    localStorage.setItem(tokenKey, "saved-token");
    localStorage.setItem(rememberKey, "true");
    expect(loadConnection()).toEqual({
      serverUrl: "https://remembered.example",
      token: "saved-token",
      remember: true,
    });
  });

  it("prefers sessionStorage over remembered localStorage when both exist", () => {
    sessionStorage.setItem(serverKey, "https://session.example");
    localStorage.setItem(serverKey, "https://remembered.example");
    localStorage.setItem(rememberKey, "true");
    expect(loadConnection().serverUrl).toBe("https://session.example");
  });

  it("saves to sessionStorage only and clears localStorage when remember is off", () => {
    // Pre-seed a stale remembered connection to prove "remember off" wipes it.
    localStorage.setItem(serverKey, "https://stale.example");
    localStorage.setItem(tokenKey, "stale");
    localStorage.setItem(rememberKey, "true");

    saveConnection({ serverUrl: "https://core.example", token: "tok", remember: false });

    expect(sessionStorage.getItem(serverKey)).toBe("https://core.example");
    expect(sessionStorage.getItem(tokenKey)).toBe("tok");
    expect(localStorage.getItem(serverKey)).toBeNull();
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(localStorage.getItem(rememberKey)).toBeNull();
  });

  it("mirrors to localStorage (token at rest) only when remember is on", () => {
    saveConnection({ serverUrl: "https://core.example", token: "tok", remember: true });

    expect(localStorage.getItem(serverKey)).toBe("https://core.example");
    expect(localStorage.getItem(tokenKey)).toBe("tok");
    expect(localStorage.getItem(rememberKey)).toBe("true");
    // The live tab always reflects the connection too.
    expect(sessionStorage.getItem(serverKey)).toBe("https://core.example");
    expect(sessionStorage.getItem(tokenKey)).toBe("tok");
  });

  it("removes an empty token instead of storing a blank string", () => {
    saveConnection({ serverUrl: "https://core.example", token: "", remember: true });
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(localStorage.getItem(tokenKey)).toBeNull();
  });

  it("round-trips a remembered connection across a fresh tab (sessionStorage cleared)", () => {
    saveConnection({ serverUrl: "https://core.example", token: "tok", remember: true });
    // Simulate opening the shareable #MB-Web link in a new tab / after a restart.
    sessionStorage.clear();
    expect(loadConnection()).toEqual({
      serverUrl: "https://core.example",
      token: "tok",
      remember: true,
    });
  });
});
