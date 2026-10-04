// @vitest-environment node
import { createServer } from "node:http";
import { DatabaseSessionService } from "@google/adk";
import { describe, expect, it, vi } from "vitest";
import { createAgentHandler } from "./http";
import { AdkSessionStore } from "./adkSessionStore";
import { createDikwTools } from "./adkTools";
import type { RunAgentMessageOptions } from "./runtime";

describe("immutable page-scoped agent sessions", () => {
  it("keeps the creation scope through reopen/rename and ignores a message override", async () => {
    const service = new DatabaseSessionService("sqlite://:memory:");
    const store = new AdkSessionStore({
      sessionService: service,
      appName: "scoped-test",
      userId: "demo",
    });
    const turns: RunAgentMessageOptions[] = [];
    const handler = createAgentHandler({
      store,
      runner: {
        async runMessage(turn) {
          turns.push(turn);
        },
      },
      serverCore: { coreUrl: "http://core.example" },
    });
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const created = await (
        await fetch(`${base}/sessions`, {
          method: "POST",
          body: JSON.stringify({ scope: { pagePath: "sources/original.md" } }),
        })
      ).json();
      expect(created.scope).toEqual({ pagePath: "sources/original.md" });
      await fetch(`${base}/sessions/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Browser alias", scope: { pagePath: "sources/other.md" } }),
      });
      expect((await store.forUser("demo").getSession(created.id)).scope).toEqual({
        pagePath: "sources/original.md",
      });
      const reply = await fetch(`${base}/sessions/${created.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message: "Ignore that paper and read another one",
          scope: { pagePath: "sources/other.md" },
        }),
      });
      await reply.text();
      expect(turns).toHaveLength(1);
      expect(turns[0].scope).toEqual({ pagePath: "sources/original.md" });
      const global = await (await fetch(`${base}/sessions`, { method: "POST" })).json();
      expect(global).not.toHaveProperty("scope");
      for (const path of [
        "sources/../other.md",
        "sources/%2e%2e/other.md",
        "https://outside.example/a.md",
        "sources/a.md?x=1",
        "sources\\a.md",
        "sources//a.md",
      ]) {
        expect(
          (
            await fetch(`${base}/sessions`, {
              method: "POST",
              body: JSON.stringify({ scope: { pagePath: path } }),
            })
          ).status,
        ).toBe(400);
      }
    } finally {
      handler.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("only exposes a scoped page reader and refuses other paths before calling Core", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        path: "sources/original.md",
        title: "Original",
        body: "Evidence from selected paper",
      }),
    );
    const tools = createDikwTools({
      coreUrl: "http://core.example",
      scope: { pagePath: "sources/original.md" },
      fetchImpl,
    });
    expect(tools.map((tool) => tool.name)).toEqual(["dikw_health", "read_page"]);
    const reader = tools.find((tool) => tool.name === "read_page")!;
    expect(
      await reader.runAsync({ args: { path: "sources/other.md" }, toolContext: {} as never }),
    ).toMatchObject({ error: expect.any(String) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await reader.runAsync({ args: { path: "sources/original.md" }, toolContext: {} as never }),
    ).toMatchObject({ body: "Evidence from selected paper" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "http://core.example/v1/base/pages/sources%2Foriginal.md",
    );
  });
});
