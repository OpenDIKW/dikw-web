import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthGate } from "../auth/gate.js";
import { withServerSpan } from "../shared/withServerSpan.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface RequestRouterOptions {
  agent: Handler;
  web: Handler;
  serveStatic: Handler;
  /** Auth mode (issue #200): the gate in front of everything, and the `/v1` proxy. */
  auth?: { gate: AuthGate; coreProxy: Handler };
}

/**
 * Top-level routing for the standalone server. `/healthz` is always open (the
 * container HEALTHCHECK). In auth mode every other request passes the gate
 * first — on its full, unstripped path — and the gate answers `/web/auth/*`
 * and every rejection itself; `/v1/*` then goes to the core proxy.
 */
export function createRequestRouter({ agent, web, serveStatic, auth }: RequestRouterOptions) {
  return async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (url.pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (auth) {
      if (!(await auth.gate.authorize(req, res))) {
        return;
      }
      if (url.pathname.startsWith("/v1/")) {
        // One route template: core paths carry page paths / task ids.
        const span = { method, pathname: "/v1/*", headers: req.headers, res };
        await withServerSpan(span, () => auth.coreProxy(req, res));
        return;
      }
    }
    for (const [prefix, handler] of [
      ["/agent", agent],
      ["/web", web],
    ] as const) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        req.url = `${url.pathname.slice(prefix.length) || "/"}${url.search}`;
        const span = { method, pathname: url.pathname, headers: req.headers, res };
        await withServerSpan(span, () => handler(req, res));
        return;
      }
    }
    await serveStatic(req, res);
  };
}
