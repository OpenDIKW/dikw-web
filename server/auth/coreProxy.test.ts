// @vitest-environment node
import { randomBytes } from "node:crypto";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreProxy } from "./coreProxy";

const TOKEN = "core-bearer-token-value";

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

describe("createCoreProxy", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop()!;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function listen(server: Server): Promise<string> {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return `http://127.0.0.1:${address.port}`;
  }

  /** A fake dikw-core plus a dikw-web front that proxies `/v1/*` to it. */
  async function setup(
    core: (req: IncomingMessage, seen: Seen, res: import("node:http").ServerResponse) => void,
  ) {
    const seen: Seen[] = [];
    const coreUrl = await listen(
      createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const record: Seen = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        seen.push(record);
        core(req, record, res);
      }),
    );
    const proxy = createCoreProxy({ coreUrl, token: TOKEN });
    const webUrl = await listen(createServer((req, res) => void proxy(req, res)));
    return { webUrl, seen };
  }

  it("forwards the request with the server-held bearer token and no browser credentials", async () => {
    const { webUrl, seen } = await setup((_req, _seen, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Set-Cookie", "core=1");
      res.end(JSON.stringify({ ok: true }));
    });
    const response = await fetch(`${webUrl}/v1/base/pages?active=true`, {
      headers: {
        Accept: "application/json",
        Cookie: "dikw_session=browser-session",
        Authorization: "Bearer browser-supplied",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toBeNull();

    expect(seen[0].method).toBe("GET");
    expect(seen[0].url).toBe("/v1/base/pages?active=true");
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.accept).toBe("application/json");
  });

  it("passes core error statuses and envelopes through unchanged", async () => {
    const { webUrl } = await setup((_req, _seen, res) => {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { code: "not_found", message: "no such page" } }));
    });
    const response = await fetch(`${webUrl}/v1/base/pages/missing.md`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("streams NDJSON incrementally instead of buffering the whole response", async () => {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const { webUrl } = await setup((_req, _seen, res) => {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(`${JSON.stringify({ type: "hit", n: 1 })}\n`);
      void released.then(() => res.end(`${JSON.stringify({ type: "done" })}\n`));
    });
    const response = await fetch(`${webUrl}/v1/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: "dikw", limit: 5 }),
    });
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    // The first line arrived while core is still holding the response open.
    expect(first).toBe('{"type":"hit","n":1}\n');
    release();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toBe('{"type":"done"}\n');
  });

  it("holds a long-poll open until core answers", async () => {
    const { webUrl, seen } = await setup((_req, _seen, res) => {
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ events: [], has_more: false }));
      }, 300);
    });
    const started = Date.now();
    const response = await fetch(`${webUrl}/v1/tasks/t-1/events?from_seq=3&wait=30`);
    expect(await response.json()).toEqual({ events: [], has_more: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(seen[0].url).toBe("/v1/tasks/t-1/events?from_seq=3&wait=30");
  });

  it("streams a multipart import body through byte-for-byte", async () => {
    const { webUrl, seen } = await setup((_req, _seen, res) => {
      res.statusCode = 202;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ task_id: "t-9" }));
    });
    const payload = randomBytes(1024 * 1024);
    const form = new FormData();
    form.append("payload", new Blob([payload]), "import.tar.gz");
    form.append("manifest", JSON.stringify({ files: [] }));
    const sent = new Request(`${webUrl}/v1/import`, { method: "POST", body: form });
    const contentType = sent.headers.get("content-type")!;
    const bytes = Buffer.from(await sent.arrayBuffer());

    const response = await fetch(`${webUrl}/v1/import`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    expect(response.status).toBe(202);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers["content-type"]).toBe(contentType);
    expect(seen[0].body.equals(bytes)).toBe(true);
  });

  it("answers 502 when core is unreachable", async () => {
    const proxy = createCoreProxy({ coreUrl: "http://127.0.0.1:1", token: TOKEN });
    const webUrl = await listen(createServer((req, res) => void proxy(req, res)));
    const response = await fetch(`${webUrl}/v1/health`);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("core_unreachable");
  });

  it("aborts the upstream request when the browser disconnects before core answers", async () => {
    // e.g. a task-event long-poll: core holds the request, the tab closes.
    let upstreamClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    let received: () => void = () => {};
    const atCore = new Promise<void>((resolve) => (received = resolve));
    const { webUrl } = await setup((req) => {
      req.socket.on("close", () => upstreamClosed());
      received();
    });
    const client = request(`${webUrl}/v1/tasks/t-1/events?wait=30`);
    client.on("error", () => {});
    client.end();
    await atCore;
    client.destroy();
    await expect(
      Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error("upstream left open")), 5000)),
      ]),
    ).resolves.toBeUndefined();
  });
});
