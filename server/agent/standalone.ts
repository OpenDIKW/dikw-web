import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { loadAgentConfig } from "./config.js";
import { createDefaultAgentHandler, resolveSessionsDir } from "./http.js";
import { createDefaultWebHandler } from "../web/http.js";
import { loadWebConfig } from "../web/config.js";

const HOST = process.env.DIKW_WEB_HOST?.trim() || "0.0.0.0";
const PORT = Number(process.env.DIKW_WEB_PORT?.trim() || "4321");

const cwd = process.cwd();
const staticRaw = process.env.DIKW_WEB_STATIC_DIR?.trim() || "dist";
const STATIC_DIR = isAbsolute(staticRaw) ? staticRaw : resolve(cwd, staticRaw);
const INDEX_HTML = join(STATIC_DIR, "index.html");
const ASSETS_DIR = join(STATIC_DIR, "assets");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8"
};

async function main(): Promise<void> {
  if (!Number.isFinite(PORT) || PORT <= 0 || PORT > 65535) {
    console.error(`[dikw-web] invalid DIKW_WEB_PORT: ${process.env.DIKW_WEB_PORT}`);
    process.exit(1);
  }

  try {
    const config = await loadAgentConfig({ cwd });
    console.log(
      `[dikw-web] agent provider=${config.provider} api=${config.api} model=${config.model}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dikw-web] agent configuration error: ${message}`);
    process.exit(1);
  }

  try {
    const webConfig = await loadWebConfig({ cwd });
    console.log(`[dikw-web] mineru enabled=${Boolean(webConfig.mineruApiKey)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dikw-web] web configuration error: ${message}`);
    process.exit(1);
  }

  try {
    const stats = await stat(INDEX_HTML);
    if (!stats.isFile()) {
      throw new Error("index.html is not a regular file");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dikw-web] static build missing at ${INDEX_HTML}: ${message}`);
    console.error("[dikw-web] run `npm run build` before starting, or set DIKW_WEB_STATIC_DIR");
    process.exit(1);
  }

  const agentHandler = await createDefaultAgentHandler(cwd);
  const webHandler = await createDefaultWebHandler(cwd);

  const server = createServer((req, res) => {
    handleRequest(req, res, agentHandler, webHandler).catch((error) => {
      console.error("[dikw-web] request error", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("internal server error");
      } else {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[dikw-web] listening on http://${HOST}:${PORT}`);
    console.log(`[dikw-web] static root: ${STATIC_DIR}`);
    console.log(`[dikw-web] sessions dir: ${resolveSessionsDir(cwd)}`);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`[dikw-web] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

type AgentHandler = Awaited<ReturnType<typeof createDefaultAgentHandler>>;
type WebHandler = Awaited<ReturnType<typeof createDefaultWebHandler>>;

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  agentHandler: AgentHandler,
  webHandler: WebHandler
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/agent" || url.pathname.startsWith("/agent/")) {
    const rest = url.pathname.slice("/agent".length) || "/";
    req.url = `${rest}${url.search ?? ""}`;
    await agentHandler(req, res);
    return;
  }
  if (url.pathname === "/web" || url.pathname.startsWith("/web/")) {
    const rest = url.pathname.slice("/web".length) || "/";
    req.url = `${rest}${url.search ?? ""}`;
    await webHandler(req, res);
    return;
  }
  await serveStatic(req.method ?? "GET", url.pathname, req.headers.accept, res);
}

async function serveStatic(
  method: string,
  pathname: string,
  accept: string | undefined,
  res: ServerResponse
): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end();
    return;
  }

  const decoded = safeDecode(pathname);
  if (decoded === null) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("bad request");
    return;
  }

  const relative = normalize(decoded).replace(/^[\\/]+/, "");
  if (relative.split(/[\\/]/).includes("..")) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("bad request");
    return;
  }

  const target = decoded === "/" || relative === "" ? INDEX_HTML : resolve(STATIC_DIR, relative);
  if (!isInside(target, STATIC_DIR)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("forbidden");
    return;
  }

  const file = await tryReadFile(target);
  if (file) {
    sendFile(res, target, file, method);
    return;
  }

  if ((accept ?? "").includes("text/html")) {
    const fallback = await tryReadFile(INDEX_HTML);
    if (fallback) {
      sendFile(res, INDEX_HTML, fallback, method);
      return;
    }
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("not found");
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isInside(child: string, parent: string): boolean {
  const childResolved = resolve(child);
  const parentResolved = resolve(parent);
  if (childResolved === parentResolved) {
    return true;
  }
  return childResolved.startsWith(parentResolved + sep);
}

async function tryReadFile(path: string): Promise<Buffer | null> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return null;
    }
    return await readFile(path);
  } catch {
    return null;
  }
}

function sendFile(res: ServerResponse, path: string, body: Buffer, method: string): void {
  const ext = extname(path).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(body.byteLength));
  if (ext === ".html") {
    res.setHeader("Cache-Control", "no-cache");
  } else if (isInside(path, ASSETS_DIR)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

main().catch((error) => {
  console.error("[dikw-web] fatal", error);
  process.exit(1);
});
