import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LegacyMbMigration } from "./LegacyMbMigration";
afterEach(() => vi.restoreAllMocks());
it("keeps export usable without a configured target and preserves invalid source data", () => {
  localStorage.setItem("dikw-mb.notes", "broken");
  render(<LegacyMbMigration />);
  expect(screen.getByText(/新应用地址尚未配置/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导出旧笔记与论文别名" }));
  expect(screen.getByText(/旧数据不是有效的 JSON/)).toBeInTheDocument();
  expect(localStorage.getItem("dikw-mb.notes")).toBe("broken");
});
it("downloads the fixed protocol and presents only a valid configured destination", () => {
  localStorage.setItem("dikw-mb.notes", "[]");
  localStorage.setItem("dikw-mb.paperNames", "{}");
  const create = vi.fn(() => "blob:test");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<LegacyMbMigration mbWebUrl="https://papers.example.com/" />);
  expect(screen.getByRole("link", { name: "打开新迈博应用" })).toHaveAttribute(
    "href",
    "https://papers.example.com/",
  );
  fireEvent.click(screen.getByRole("button", { name: "导出旧笔记与论文别名" }));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:test");
  expect(localStorage.getItem("dikw-mb.notes")).toBe("[]");
});
it("does not create a link from an unsafe configured destination", () => {
  render(<LegacyMbMigration mbWebUrl="javascript:alert(1)" />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(/仍然可以导出旧数据/)).toBeInTheDocument();
});
