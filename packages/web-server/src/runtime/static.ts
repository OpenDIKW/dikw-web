import type { ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
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

export function createStaticHandler(STATIC_DIR: string) {
  const INDEX_HTML = join(STATIC_DIR, "index.html");
  const ASSETS_DIR = join(STATIC_DIR, "assets");
  return serveStatic;
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
}
