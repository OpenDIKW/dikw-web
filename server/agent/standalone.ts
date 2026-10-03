import { createServer } from "node:http";
import { createWebRuntime, createLogger } from "@opendikw/web-server/runtime";
import { registerOutboundInstrumentation } from "@opendikw/web-server/instrumentation";

// Register before the factory makes any outbound request.
registerOutboundInstrumentation();
const log = createLogger("server", "dikw-web");

async function main(): Promise<void> {
  const host = process.env.DIKW_WEB_HOST?.trim() || "0.0.0.0";
  const port = Number(process.env.DIKW_WEB_PORT?.trim() || "4321");
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error("invalid DIKW_WEB_PORT");
  const runtime = await createWebRuntime({ appId: "dikw-web", profile: "workbench" });
  const server = createServer((req, res) => {
    void runtime.handler(req, res);
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
  log.error("startup failed", { error });
  process.exit(1);
});
