// Same-origin `/v1/*` → dikw-core proxy for auth mode (the `DIKW_WEB_CORE_PROXY`
// idea from docs/deployment.md). The gate has already authenticated and
// authorized the caller; this forwards to the server-configured core with the
// server-held bearer token, so the browser never sees the token and core never
// sees a browser credential. Bodies stream both ways — NDJSON retrieve, task
// event long-polls and multipart imports are never buffered.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createLogger } from "../shared/logger.js";

const log = createLogger("core-proxy");

// Only what core needs to interpret the request. Cookie / Authorization (the
// browser's own credentials) and hop-by-hop headers never cross.
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "content-length"] as const;
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "trailer",
  "te",
  "set-cookie",
]);

export interface CoreProxyOptions {
  coreUrl: string;
  token: string;
}

export function createCoreProxy({ coreUrl, token }: CoreProxyOptions) {
  const active = new Map<AbortController, ServerResponse>();
  let closed = false;
  const handler = async function coreProxy(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (closed) {
      res.statusCode = 503;
      res.end("application is closed");
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // Keep bytes verbatim: fetch would otherwise decompress while the
      // Content-Encoding / Content-Length headers still describe the wire form.
      "Accept-Encoding": "identity",
    };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }

    // Browser went away (or the response finished — then this is a no-op):
    // stop the upstream request instead of letting it run on.
    const controller = new AbortController();
    active.set(controller, res);
    res.on("close", () => {
      controller.abort();
      active.delete(controller);
    });

    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    let upstream: Response;
    try {
      upstream = await fetch(`${coreUrl}${url.pathname}${url.search}`, {
        method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
        duplex: "half",
        signal: controller.signal,
      } as RequestInit);
    } catch (error) {
      if (controller.signal.aborted) return;
      log.warn("core unreachable", { error });
      return sendError(res, "core_unreachable", "core unreachable");
    }

    if (upstream.status === 401) {
      // The gate already admitted this browser, so core is rejecting the server
      // token: a misconfiguration, not an expired sign-in. Passing the 401 on
      // would send the SPA to login, back here, and to login again forever.
      void upstream.body?.cancel();
      log.warn("core rejected DIKW_SERVER_TOKEN", { status: upstream.status });
      return sendError(res, "core_auth_failed", "core rejected the server token");
    }

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (!DROPPED_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
    });
    // Every response is now per-session (the gate authorized this caller), so a
    // shared cache in front of dikw-web must never replay it to someone else —
    // including core's long-lived `public, immutable` assets.
    res.setHeader("Cache-Control", privateCacheControl(upstream.headers.get("cache-control")));
    if (!upstream.body || method === "HEAD") {
      res.end();
      return;
    }
    res.flushHeaders();
    try {
      await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream), res);
    } catch {
      // Browser disconnect or upstream reset mid-stream: nothing left to send.
    }
  };
  return Object.assign(handler, {
    abort() {
      closed = true;
      for (const [controller, res] of active) {
        controller.abort();
        res.destroy();
      }
      active.clear();
    },
  });
}

/** Core's caching policy, minus anything that lets a shared cache store it. */
function privateCacheControl(upstream: string | null): string {
  const directives = (upstream ?? "")
    .split(",")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^(public|private|s-maxage=.*)$/i.test(directive));
  return ["private", ...directives].join(", ");
}

function sendError(res: ServerResponse, code: string, message: string): void {
  res.statusCode = 502;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { code, message } }));
}
