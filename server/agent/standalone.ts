import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { loadAgentConfig } from "./config.js";
import { createDefaultAgentHandler, resolveSessionsDir } from "./http.js";
import { createRequestRouter, type RequestRouterOptions } from "./requestRouter.js";
import { createDefaultWebHandler } from "../web/http.js";
import { loadWebConfig } from "../web/config.js";
import { loadAuthConfig, type AuthConfig } from "../auth/config.js";
import { createAuthGate } from "../auth/gate.js";
import { createOidcClient } from "../auth/oidc.js";
import { AuthSessionStore } from "../auth/sessionStore.js";
import { createCoreProxy } from "../auth/coreProxy.js";
import { createLogger } from "../shared/logger.js";
import { registerOutboundInstrumentation } from "./instrumentation.js";

// Patch outbound undici/fetch for CLIENT spans before anything makes a request.
// No-op unless an OTLP traces endpoint is configured (see instrumentation.ts).
registerOutboundInstrumentation();

const log = createLogger("server");

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
  ".txt": "text/plain; charset=utf-8",
};

async function main(): Promise<void> {
  if (!Number.isFinite(PORT) || PORT <= 0 || PORT > 65535) {
    log.error("invalid DIKW_WEB_PORT", { value: process.env.DIKW_WEB_PORT });
    process.exit(1);
  }

  try {
    const config = await loadAgentConfig({ cwd });
    log.info("agent config loaded", {
      provider: config.provider,
      api: config.api,
      model: config.model,
    });
  } catch (error) {
    log.error("agent configuration error", { error });
    process.exit(1);
  }

  try {
    const webConfig = await loadWebConfig({ cwd });
    log.info("web config loaded", { mineruEnabled: Boolean(webConfig.mineruApiKey) });
  } catch (error) {
    log.error("web configuration error", { error });
    process.exit(1);
  }

  let authConfig: AuthConfig | null;
  try {
    authConfig = await loadAuthConfig({ cwd });
    if (authConfig) {
      log.info("auth mode enabled", {
        mode: "oidc",
        issuer: authConfig.issuer,
        publicUrl: authConfig.publicUrl,
      });
    }
  } catch (error) {
    log.error("auth configuration error", { error });
    process.exit(1);
  }

  try {
    const stats = await stat(INDEX_HTML);
    if (!stats.isFile()) {
      throw new Error("index.html is not a regular file");
    }
  } catch (error) {
    log.error("static build missing — run `npm run build` or set DIKW_WEB_STATIC_DIR", {
      path: INDEX_HTML,
      error,
    });
    process.exit(1);
  }

  let auth: RequestRouterOptions["auth"];
  if (authConfig) {
    // Login sessions live next to agent.sqlite, on the same volume.
    const sessionsDir = resolveSessionsDir(cwd);
    await mkdir(sessionsDir, { recursive: true });
    const sessions = new AuthSessionStore({
      path: join(sessionsDir, "auth.sqlite"),
      secret: authConfig.sessionSecret,
    });
    auth = {
      gate: createAuthGate({ config: authConfig, oidc: createOidcClient(authConfig), sessions }),
      coreProxy: createCoreProxy({ coreUrl: authConfig.coreUrl, token: authConfig.serverToken }),
    };
  }
  const gate = auth?.gate;
  const agentHandler = await createDefaultAgentHandler(
    cwd,
    authConfig && gate
      ? {
          // The gate has admitted every request that reaches /agent.
          userIdFor: (req) => gate.principalOf(req)!.sub,
          legacySessionsOwner: authConfig.legacySessionsOwner,
          serverCore: { coreUrl: authConfig.coreUrl, token: authConfig.serverToken },
        }
      : {},
  );
  const webHandler = await createDefaultWebHandler(cwd);
  const route = createRequestRouter({
    agent: (req, res) => agentHandler(req, res),
    web: (req, res) => webHandler(req, res),
    serveStatic: (req, res) =>
      serveStatic(
        req.method ?? "GET",
        new URL(req.url ?? "/", "http://localhost").pathname,
        req.headers.accept,
        res,
      ),
    auth,
  });

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      log.error("request error", { error });
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
    log.info("listening", {
      url: `http://${HOST}:${PORT}`,
      staticRoot: STATIC_DIR,
      sessionsDir: resolveSessionsDir(cwd),
    });
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    log.info("received signal, shutting down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function serveStatic(
  method: string,
  pathname: string,
  accept: string | undefined,
  res: ServerResponse,
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
  log.error("fatal", { error });
  process.exit(1);
});
