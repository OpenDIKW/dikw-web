import type { Plugin } from "vite";
import { createDefaultAgentHandler } from "./http.js";
import { withServerSpan } from "../shared/withServerSpan.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("agent-sidecar");

/**
 * Validate the dev `/v1` proxy target (`VITE_DIKW_PROXY_TARGET`) before the
 * sidecar mirrors it. Returns the trimmed value for an absolute http(s) URL,
 * `undefined` (silently) when unset, and `undefined` + a warning when set but
 * malformed — so a typo (e.g. a missing scheme) is diagnosed rather than
 * surfacing later as the opaque `fetch failed`.
 */
export function resolveDevProxyTarget(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
    return value;
  } catch {
    log.warn(
      "ignoring malformed VITE_DIKW_PROXY_TARGET (must be an absolute http(s) URL); agent tools will not reach a proxied core",
    );
    return undefined;
  }
}

export function agentSidecarPlugin(): Plugin {
  // The dev `/v1` proxy target, so the sidecar's outbound `/agent` core calls can
  // mirror it (see applyDevProxyTarget in http.ts). Resolved from Vite's own env
  // — which loadEnv populates from `.env.local`/`.env` AND process.env — so it
  // matches what the `server.proxy` block in vite.config.ts actually uses,
  // instead of only seeing a shell-exported value.
  let devProxyTarget: string | undefined;

  return {
    name: "dikw-agent-sidecar",
    configResolved(config) {
      devProxyTarget = resolveDevProxyTarget(config.env?.VITE_DIKW_PROXY_TARGET);
    },
    configureServer(server) {
      let handlerPromise: ReturnType<typeof createDefaultAgentHandler> | null = null;
      server.middlewares.use("/agent", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultAgentHandler(process.cwd(), { devProxyTarget });
          const handler = await handlerPromise;
          // Connect strips the "/agent" mount prefix from req.url; rebuild the
          // full path for the route template.
          const sub = new URL(req.url ?? "/", "http://localhost").pathname;
          const pathname = sub === "/" ? "/agent" : `/agent${sub}`;
          await withServerSpan(
            { method: req.method ?? "GET", pathname, headers: req.headers, res },
            () => handler(req, res, next),
          );
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
