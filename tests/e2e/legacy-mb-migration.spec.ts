import { readFile } from "node:fs/promises";
import { test, expect } from "./harness";
import { mockDikwApi } from "./mockApi";
test("explicitly exports legacy notes and paper names without credentials or deleting the source", async ({
  page,
}) => {
  await mockDikwApi(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "dikw-mb.notes",
      JSON.stringify([
        {
          nid: "old",
          type: "thought",
          quote: "",
          txt: "Legacy thought",
          src: "",
          srcType: "",
          tags: [],
          ts: 1,
        },
      ]),
    );
    localStorage.setItem(
      "dikw-mb.paperNames",
      JSON.stringify({ "sources/paper.md": "Legacy alias" }),
    );
    localStorage.setItem("dikw-web.token", "not-exported-fixture");
  });
  await page.goto("/#MB-Web");
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出笔记与论文别名", exact: true }).click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe("dikw-mbweb-migration.json");
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await readFile(path!, "utf8");
  const data = JSON.parse(text);
  expect(data).toEqual({
    schema: "dikw-mbweb-migration",
    version: 1,
    notes: [
      {
        nid: "old",
        type: "thought",
        quote: "",
        txt: "Legacy thought",
        src: "",
        srcType: "",
        tags: [],
        ts: 1,
      },
    ],
    paperNames: { "sources/paper.md": "Legacy alias" },
  });
  expect(text).not.toContain("not-exported-fixture");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dikw-mb.notes")!)[0].txt)).toBe(
    "Legacy thought",
  );
  expect(await page.evaluate(() => localStorage.getItem("dikw-mb.paperNames"))).toBe(
    '{"sources/paper.md":"Legacy alias"}',
  );
});
