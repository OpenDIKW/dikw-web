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
  return async function coreProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    res.on("close", () => controller.abort());

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
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "core_unreachable", message: "core unreachable" } }));
      return;
    }

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (!DROPPED_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
    });
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
}
