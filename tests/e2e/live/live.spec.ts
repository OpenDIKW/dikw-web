import { expect, test } from "./live-fixtures";

// Browser-level end-to-end against a REAL, seeded dikw-core. Assertions are
// shape-based (not exact counts) so they survive real data, while the harness
// console gate fails the test on any runtime error on real responses — the
// thing the mocked suite cannot see. Requires `npm run live:up` + `live:seed`
// (run.mjs does both before invoking Playwright in live mode).

test("Overview renders real core health/status", async ({ page }) => {
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // The connection panel must show a connected posture, not an error banner.
  await expect(page.getByText(/source|knowledge|wisdom/i).first()).toBeVisible();
});

test("Base lists seeded pages and reads one", async ({ page }) => {
  await page.goto("/#base");
  await expect(page.getByRole("heading", { name: "Base", exact: true })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Base directory" })).toBeVisible();
  // The fixture seeds ≥3 source pages (+ synthesized knowledge pages).
  await expect(page.getByRole("treeitem").first()).toBeVisible();
  const reader = page.getByRole("main", { name: "Wiki reader" });
  await expect(reader).toBeVisible();
  await expect(reader.getByRole("heading").first()).toBeVisible();
});

test("Graph renders the active graph from real data", async ({ page }) => {
  await page.goto("/#graph");
  await expect(page.getByRole("heading", { name: "Graph" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Base graph" })).toBeVisible();
  await expect(page.locator('.graph-pixi-mount[data-ready="true"]')).toBeVisible({
    timeout: 15_000,
  });
  // Wikilinks between the fixture pages guarantee a non-empty graph.
  await expect(page.getByText(/\d+ nodes?/)).toBeVisible();
});

test("Tasks lists the seeded write-pipeline tasks", async ({ page }) => {
  await page.goto("/#tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  // Seeding ran ingest/synth/lint; at least one of those ops is listed.
  await expect(page.getByText(/ingest|synth|lint/i).first()).toBeVisible();
});
