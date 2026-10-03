import type { Plugin } from "vite";
import { createDefaultWebHandler } from "./http.js";
import { withServerSpan } from "../shared/withServerSpan.js";
import { applicationContext } from "../shared/logger.js";
import type { ApplicationId } from "../runtime/profile.js";

/** Mounts /web/* on the Vite dev server. Sibling to agentSidecarPlugin().
 *  Standalone server (server/agent/standalone.ts) registers the same
 *  prefix manually so dev and prod stay in sync. */
export function webApiPlugin(options: { appId?: ApplicationId } = {}): Plugin {
  let cwd = process.cwd();
  let handlerPromise: ReturnType<typeof createDefaultWebHandler> | null = null;
  return {
    name: "dikw-web-api",
    configResolved(config) {
      cwd = config.root;
    },
    configureServer(server) {
      server.middlewares.use("/web", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultWebHandler(cwd, options);
          const handler = await handlerPromise;
          // Connect strips the "/web" mount prefix from req.url; rebuild the
          // full path for the route template.
          const sub = new URL(req.url ?? "/", "http://localhost").pathname;
          const pathname = sub === "/" ? "/web" : `/web${sub}`;
          await applicationContext.run(options.appId ?? "dikw-web", () =>
            withServerSpan(
              { method: req.method ?? "GET", pathname, headers: req.headers, res },
              () => handler(req, res, next),
            ),
          );
        } catch (err) {
          next(err);
        }
      });
    },
    async closeBundle() {
      await (await handlerPromise)?.close();
    },
  };
}
