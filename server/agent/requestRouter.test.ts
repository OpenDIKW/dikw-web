// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthGate, Principal } from "../auth/gate";
import { createRequestRouter } from "./requestRouter";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

describe("createRequestRouter", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  /** Each stub handler answers with its own name + the req.url it saw. */
  function stub(name: string): Handler {
    return async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ handler: name, url: req.url }));
    };
  }

  function fakeGate(admit: boolean) {
    const seen: string[] = [];
    const gate: AuthGate = {
      async authorize(req, res) {
        seen.push(`${req.method} ${req.url}`);
        if (!admit) {
          res.statusCode = 401;
          res.end(JSON.stringify({ handler: "gate" }));
          return null;
        }
        return { sub: "u-1", role: "viewer" } satisfies Principal;
      },
      principalOf: () => undefined,
    };
    return { gate, seen };
  }

  async function serve(router: ReturnType<typeof createRequestRouter>): Promise<string> {
    const server = createServer((req, res) => void router(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return `http://127.0.0.1:${address.port}`;
  }

  const handlers = {
    agent: stub("agent"),
    web: stub("web"),
    serveStatic: stub("static"),
  };

  async function get(base: string, path: string, method = "GET") {
    const response = await fetch(`${base}${path}`, { method });
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  }

  it("auth off: routes by prefix exactly as before, with an open /healthz", async () => {
    const base = await serve(createRequestRouter(handlers));
    expect((await get(base, "/healthz")).body).toEqual({ status: "ok" });
    expect((await get(base, "/agent/sessions")).body).toEqual({
      handler: "agent",
      url: "/sessions",
    });
    expect((await get(base, "/web/auth/me")).body).toEqual({ handler: "web", url: "/auth/me" });
    expect((await get(base, "/v1/health")).body).toEqual({ handler: "static", url: "/v1/health" });
    expect((await get(base, "/")).body).toEqual({ handler: "static", url: "/" });
  });

  it("auth on: every route except /healthz passes the gate first, on the full path", async () => {
    const { gate, seen } = fakeGate(false);
    const base = await serve(
      createRequestRouter({ ...handlers, auth: { gate, coreProxy: stub("core") } }),
    );
    expect((await get(base, "/healthz")).body).toEqual({ status: "ok" });
    for (const path of [
      "/",
      "/assets/index.js",
      "/v1/base/pages",
      "/agent/sessions",
      "/web/translate/health",
      // The real gate answers /web/auth/* itself (and returns null), so the
      // web handler never sees it.
      "/web/auth/me",
    ]) {
      const { status, body } = await get(base, path);
      expect(status, path).toBe(401);
      expect(body, path).toEqual({ handler: "gate" });
    }
    expect(seen).toEqual([
      "GET /",
      "GET /assets/index.js",
      "GET /v1/base/pages",
      "GET /agent/sessions",
      "GET /web/translate/health",
      "GET /web/auth/me",
    ]);
  });

  it("auth on: admitted requests reach the core proxy, agent, web and static handlers", async () => {
    const { gate } = fakeGate(true);
    const base = await serve(
      createRequestRouter({ ...handlers, auth: { gate, coreProxy: stub("core") } }),
    );
    expect((await get(base, "/v1/base/pages?active=true")).body).toEqual({
      handler: "core",
      url: "/v1/base/pages?active=true",
    });
    expect((await get(base, "/agent/sessions")).body).toEqual({
      handler: "agent",
      url: "/sessions",
    });
    expect((await get(base, "/web/translate/health")).body).toEqual({
      handler: "web",
      url: "/translate/health",
    });
    expect((await get(base, "/base")).body).toEqual({ handler: "static", url: "/base" });
  });
});
