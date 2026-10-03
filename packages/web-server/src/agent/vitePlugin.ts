import type { Plugin } from "vite";
import { createDefaultAgentHandler } from "./http.js";
import { withServerSpan } from "../shared/withServerSpan.js";
import { createLogger } from "../shared/logger.js";
import { applicationContext } from "../shared/logger.js";
import type { ApplicationId, ApplicationProfile } from "../runtime/profile.js";

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

export function agentSidecarPlugin(
  options: { appId?: ApplicationId; profile?: ApplicationProfile } = {},
): Plugin {
  // The dev `/v1` proxy target, so the sidecar's outbound `/agent` core calls can
  // mirror it (see applyDevProxyTarget in http.ts). Resolved from Vite's own env
  // — which loadEnv populates from `.env.local`/`.env` AND process.env — so it
  // matches what the `server.proxy` block in vite.config.ts actually uses,
  // instead of only seeing a shell-exported value.
  let devProxyTarget: string | undefined;
  let cwd = process.cwd();
  let handlerPromise: ReturnType<typeof createDefaultAgentHandler> | null = null;
  const pending = new Set<Promise<void>>();

  return {
    name: "dikw-agent-sidecar",
    configResolved(config) {
      cwd = config.root;
      devProxyTarget = resolveDevProxyTarget(config.env?.VITE_DIKW_PROXY_TARGET);
    },
    configureServer(server) {
      server.middlewares.use("/agent", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultAgentHandler(cwd, { devProxyTarget, ...options });
          const handler = await handlerPromise;
          // Connect strips the "/agent" mount prefix from req.url; rebuild the
          // full path for the route template.
          const sub = new URL(req.url ?? "/", "http://localhost").pathname;
          const pathname = sub === "/" ? "/agent" : `/agent${sub}`;
          const request = applicationContext.run(options.appId ?? "dikw-web", () =>
            withServerSpan(
              { method: req.method ?? "GET", pathname, headers: req.headers, res },
              () => handler(req, res, next),
            ),
          );
          pending.add(request);
          try {
            await request;
          } finally {
            pending.delete(request);
          }
        } catch (error) {
          next(error);
        }
      });
    },
    async closeBundle() {
      if (!handlerPromise) return;
      const handler = await handlerPromise;
      handler.abort();
      await Promise.allSettled([...pending]);
      await handler.close();
    },
  };
}
