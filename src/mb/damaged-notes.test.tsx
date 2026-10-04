import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AuthContext } from "@opendikw/web-ui/auth";
import { MbApp } from "./MbApp";

it("keeps the actual paper library readable while damaged notes stay protected", async () => {
  const raw = "{broken notes";
  localStorage.setItem("dikw-mb.notes", raw);
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    return new Response(
      JSON.stringify(
        path === "/v1/base/pages"
          ? [{ path: "sources/intact.md", title: "Intact paper", layer: "source" }]
          : { enabled: false },
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthContext.Provider value={{ enabled: true, user: { sub: "u" }, role: "editor" }}>
      <MbApp />
    </AuthContext.Provider>,
  );
  expect(await screen.findByRole("button", { name: /Intact paper/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /我的笔记/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("笔记数据损坏");
  expect(localStorage.getItem("dikw-mb.notes")).toBe(raw);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "论文研究" }));
  expect(screen.getByRole("button", { name: /Intact paper/ })).toBeVisible();
  expect(localStorage.getItem("dikw-mb.notes")).toBe(raw);
});
