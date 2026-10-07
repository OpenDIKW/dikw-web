import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createWebRuntime, createLogger } from "@opendikw/web-server/runtime";
import { registerOutboundInstrumentation } from "@opendikw/web-server/instrumentation";
import { createWorkbenchHandler } from "./workbenchHandler.js";

// Register before the factory makes any outbound request.
registerOutboundInstrumentation();
const log = createLogger("server", "dikw-web");

async function main(): Promise<void> {
  const host = process.env.DIKW_WEB_HOST?.trim() || "0.0.0.0";
  const port = Number(process.env.DIKW_WEB_PORT?.trim() || "4321");
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error("invalid DIKW_WEB_PORT");
  const fileEnv = await readFile(".env.local", "utf8").then(
    parseEnv,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    },
  );
  const env = { ...fileEnv, ...process.env };
  const staticDir = resolve(env.DIKW_WEB_STATIC_DIR?.trim() || "dist");
  const runtime = await createWebRuntime({ appId: "dikw-web", profile: "workbench", staticDir });
  const handler = createWorkbenchHandler(runtime, staticDir);
  const server = createServer((req, res) => {
    void handler(req, res).catch((error) => {
      log.error("request failed", { error });
      if (!res.headersSent) res.statusCode = 500;
      res.end("internal server error");
    });
  });
  server.listen(port, host, () => log.info("listening", { host, port }));
  const shutdown = (): void => {
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.all([stopped, runtime.close()]).then(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error) => {
  // The logger never records an Error message. Startup makes no provider call
  // (OIDC discovery is lazy), so this reason is our own config or system error.
  log.error("startup failed", {
    error,
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
