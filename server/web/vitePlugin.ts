import type { Plugin } from "vite";
import { createDefaultWebHandler } from "./http.js";

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
          await handler(req, res, next);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}
