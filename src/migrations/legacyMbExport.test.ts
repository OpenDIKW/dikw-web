import { expect, it } from "vitest";
import { exportLegacyMbData, MAX_MIGRATION_BYTES } from "./legacyMbExport";
it("exports only notes and paper names and leaves old storage intact", () => {
  const notes = [
    {
      nid: "a",
      quote: "Evidence",
      txt: "Thought",
      tags: ["tag"],
      srcPath: "sources/paper.md",
      wisdomPath: "wisdom/a.md",
    },
  ];
  localStorage.setItem("dikw-mb.notes", JSON.stringify(notes));
  localStorage.setItem("dikw-mb.paperNames", JSON.stringify({ "sources/paper.md": "My title" }));
  localStorage.setItem("dikw-web.token", "secret");
  const text = exportLegacyMbData(localStorage);
  expect(JSON.parse(text)).toEqual({
    schema: "dikw-mbweb-migration",
    version: 1,
    notes,
    paperNames: { "sources/paper.md": "My title" },
  });
  expect(text).not.toContain("secret");
  expect(JSON.parse(localStorage.getItem("dikw-mb.notes")!)).toEqual(notes);
});
it("exports empty data and refuses corrupt or oversized storage without deleting it", () => {
  expect(JSON.parse(exportLegacyMbData(localStorage)).notes).toEqual([]);
  for (const raw of [
    "bad",
    "{}",
    JSON.stringify(Array(10001).fill({})),
    JSON.stringify([{ txt: "x".repeat(MAX_MIGRATION_BYTES) }]),
  ]) {
    const store = new Map([["dikw-mb.notes", raw]]);
    const storage = { getItem: (key: string) => store.get(key) ?? null };
    expect(() => exportLegacyMbData(storage)).toThrow();
    expect(store.get("dikw-mb.notes")).toBe(raw);
  }
});
