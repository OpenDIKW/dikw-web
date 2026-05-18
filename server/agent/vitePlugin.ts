import type { Plugin } from "vite";
import { createDefaultAgentHandler } from "./http.js";

export function agentSidecarPlugin(): Plugin {
  return {
    name: "dikw-agent-sidecar",
    configureServer(server) {
      let handlerPromise: ReturnType<typeof createDefaultAgentHandler> | null = null;
      server.middlewares.use("/agent", async (req, res, next) => {
        try {
          handlerPromise ??= createDefaultAgentHandler(process.cwd());
          const handler = await handlerPromise;
          await handler(req, res, next);
        } catch (error) {
          next(error);
        }
      });
    }
  };
}
