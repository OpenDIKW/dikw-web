import type { Plugin } from "vite";
import { createDefaultAgentHandler } from "./http.js";
import { withServerSpan } from "../shared/withServerSpan.js";

export function agentSidecarPlugin(): Plugin {
  return {
    name: "dikw-agent-sidecar",
    configureServer(server) {
      let handlerPromise: ReturnType<typeof createDefaultAgentHandler> | null = null;
      server.middlewares.use("/agent", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultAgentHandler(process.cwd());
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
