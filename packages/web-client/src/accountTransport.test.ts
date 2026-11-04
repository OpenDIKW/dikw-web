import { expect, it, vi } from "vitest";
import { AgentClient } from "./agent/agentClient";
import { DikwClient } from "./core/client";

it("pins Agent session CRUD, aborts, proposals and model turns through the explicit transport", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/messages")
      ? new Response('{"type":"agent_end","sessionId":"s"}\n')
      : Response.json({ id: "s" }),
  );
  const client = new AgentClient({
    fetch: fetcher,
    requestHeaders: () => ({
      "X-DIKW-Expected-Identity": "page-alice",
      Authorization: "must-not-forward",
      Cookie: "must-not-forward",
    }),
  });
  await client.listSessions();
  await client.createSession();
  await client.getSession("s");
  await client.getSessionTraces("s");
  await client.renameSession("s", "Title");
  await client.abort("s");
  await client.confirmProposal("s", "p");
  await client.rejectProposal("s", "p");
  await client.deleteSession("s");
  for await (const event of client.sendMessage("s", "question"))
    expect(event.type).toBe("agent_end");
  expect(fetcher).toHaveBeenCalledTimes(10);
  for (const call of fetcher.mock.calls) {
    const headers = new Headers((call as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("X-DIKW-Expected-Identity")).toBe("page-alice");
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Cookie")).toBe(false);
  }
});

it("pins Core JSON, multipart and streaming calls without sending metadata to another origin", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/stream") ? new Response('{"type":"event"}\n') : Response.json({}),
  );
  const config = {
    fetch: fetcher,
    requestHeaders: () => ({
      "X-DIKW-Expected-Identity": "page-alice",
      "Content-Type": "invalid",
      Authorization: "invalid",
    }),
  };
  const client = new DikwClient(config);
  await client.get("/v1/base/pages");
  await client.post("/v1/base/wisdom", {});
  await client.postMultipart("/v1/import", new FormData());
  for await (const event of client.streamNdjson("/v1/stream"))
    expect(event).toEqual({ type: "event" });
  for (const call of fetcher.mock.calls)
    expect(
      new Headers((call as unknown as [string, RequestInit])[1].headers).get(
        "X-DIKW-Expected-Identity",
      ),
    ).toBe("page-alice");
  expect(
    new Headers((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].headers).has(
      "Content-Type",
    ),
  ).toBe(false);
  const external = new DikwClient({ ...config, baseUrl: "https://other.example" });
  await external.get("/v1/base/pages");
  expect(
    new Headers((fetcher.mock.calls[4] as unknown as [string, RequestInit])[1].headers).has(
      "X-DIKW-Expected-Identity",
    ),
  ).toBe(false);
});
