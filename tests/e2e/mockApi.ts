import type { Page } from "@playwright/test";
import {
  infoFixture,
  readyFixture,
  statusFixture,
  taskEventsFixture,
  taskRowsFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
  wisdomItemsFixture
} from "./fixtures";

export async function mockDikwApi(page: Page) {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/v1/info") {
      await route.fulfill({ json: infoFixture });
      return;
    }
    if (path === "/v1/readyz") {
      await route.fulfill({ json: readyFixture });
      return;
    }
    if (path === "/v1/status") {
      await route.fulfill({ json: statusFixture });
      return;
    }
    if (path === "/v1/wiki/pages") {
      await route.fulfill({ json: wikiPagesFixture });
      return;
    }
    if (path.startsWith("/v1/wiki/pages/")) {
      const selectedPath = decodeURIComponent(path.replace("/v1/wiki/pages/", ""));
      await route.fulfill({ json: wikiPageBodiesFixture[selectedPath] });
      return;
    }
    if (path === "/v1/wisdom") {
      await route.fulfill({ json: wisdomItemsFixture });
      return;
    }
    if (path === "/v1/tasks") {
      await route.fulfill({ json: taskRowsFixture });
      return;
    }
    if (path === "/v1/tasks/eval-task-1/events") {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: taskEventsFixture.map((event) => JSON.stringify(event)).join("\n")
      });
      return;
    }

    await route.fulfill({ status: 404, body: `No mock for ${path}` });
  });
}
