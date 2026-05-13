import type { Page } from "@playwright/test";
import {
  healthFixture,
  infoFixture,
  retrieveEventsFixture,
  statusFixture,
  taskEventsFixture,
  taskRowsFixture,
  wikiPageBodiesFixture,
  wikiPagesFixture,
  wisdomItemsFixture
} from "./fixtures";

export async function mockDikwApi(page: Page) {
  await page.route("**/agent/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/agent/sessions") {
      if (route.request().method() === "POST") {
        await route.fulfill({
          json: {
            id: "session-1",
            title: "New chat",
            createdAt: "2026-05-13T00:00:00.000Z",
            updatedAt: "2026-05-13T00:00:00.000Z",
            messageCount: 0,
            lastMessagePreview: "",
            messages: [],
            toolEvents: [],
            sources: [],
            proposals: []
          }
        });
        return;
      }
      await route.fulfill({ json: [] });
      return;
    }

    if (path === "/agent/sessions/session-1") {
      await route.fulfill({
        json: {
          id: "session-1",
          title: "What is DIKW?",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:01.000Z",
          messageCount: 2,
          lastMessagePreview: "Layered answer.",
          messages: [
            { id: "m1", role: "user", content: "What is DIKW?", createdAt: "2026-05-13T00:00:00.000Z" },
            { id: "m2", role: "assistant", content: "Layered answer.", createdAt: "2026-05-13T00:00:01.000Z" }
          ],
          toolEvents: [],
          sources: [{ path: "wiki/concepts/architecture.md", title: "Architecture", layer: "wiki" }],
          proposals: []
        }
      });
      return;
    }

    if (path === "/agent/sessions/session-1/messages") {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: [
          JSON.stringify({ type: "message_delta", sessionId: "session-1", delta: "Layered answer." }),
          JSON.stringify({
            type: "source",
            sessionId: "session-1",
            source: { path: "wiki/concepts/architecture.md", title: "Architecture", layer: "wiki" }
          }),
          JSON.stringify({ type: "agent_end", sessionId: "session-1" })
        ].join("\n")
      });
      return;
    }

    if (path === "/agent/sessions/session-1/abort") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({ status: 404, body: `No agent mock for ${path}` });
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/v1/info") {
      await route.fulfill({ json: infoFixture });
      return;
    }
    if (path === "/v1/health") {
      await route.fulfill({ json: healthFixture });
      return;
    }
    if (path === "/v1/status") {
      await route.fulfill({ json: statusFixture });
      return;
    }
    if (path === "/v1/base/pages") {
      await route.fulfill({ json: wikiPagesFixture });
      return;
    }
    if (path.startsWith("/v1/base/pages/")) {
      const selectedPath = decodeURIComponent(path.replace("/v1/base/pages/", ""));
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
    if (path === "/v1/retrieve") {
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: retrieveEventsFixture.map((event) => JSON.stringify(event)).join("\n")
      });
      return;
    }

    await route.fulfill({ status: 404, body: `No mock for ${path}` });
  });
}
