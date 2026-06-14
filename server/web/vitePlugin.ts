import type { Plugin } from "vite";
import { createDefaultWebHandler } from "./http.js";
import { withServerSpan } from "../shared/withServerSpan.js";

/** Mounts /web/* on the Vite dev server. Sibling to agentSidecarPlugin().
 *  Standalone server (server/agent/standalone.ts) registers the same
 *  prefix manually so dev and prod stay in sync. */
export function webApiPlugin(): Plugin {
  return {
    name: "dikw-web-api",
    configureServer(server) {
      let handlerPromise: ReturnType<typeof createDefaultWebHandler> | null = null;
      server.middlewares.use("/web", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultWebHandler(process.cwd());
          const handler = await handlerPromise;
          // Connect strips the "/web" mount prefix from req.url; rebuild the
          // full path for the route template.
          const sub = new URL(req.url ?? "/", "http://localhost").pathname;
          const pathname = sub === "/" ? "/web" : `/web${sub}`;
          await withServerSpan(
            { method: req.method ?? "GET", pathname, headers: req.headers, res },
            () => handler(req, res, next),
          );
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
