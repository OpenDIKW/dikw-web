import type { IncomingMessage, ServerResponse } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { WebRuntime } from "@opendikw/web-server/runtime";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Only the public workbench's built shell is anonymous; APIs use the shared gate. */
export function createWorkbenchHandler(runtime: WebRuntime, staticDir: string) {
  const root = resolve(staticDir);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return runtime.handler(req, res);
    }
    const segments = path.split("/").filter(Boolean);
    const extension = extname(path).toLowerCase();
    const safe =
      !path.includes("\\") &&
      !path.includes("\0") &&
      !segments.some((part) => part === "." || part === "..");
    const asset =
      (path.startsWith("/assets/") || path.startsWith("/fonts/")) &&
      extension !== ".html" &&
      extension !== ".json" &&
      !!TYPES[extension];
    const rootImage = segments.length === 1 && /^\.(svg|png|jpe?g|webp|gif|ico)$/.test(extension);
    const shell = path === "/" || path === "/index.html" || path === "/config.json";
    if (!safe || !["GET", "HEAD"].includes(method) || !(shell || asset || rootImage)) {
      return runtime.handler(req, res);
    }
    const parts = path === "/" ? ["index.html"] : segments;
    let file = root;
    try {
      for (const part of ["", ...parts]) {
        file = join(file, part);
        const metadata = await lstat(file);
        if (metadata.isSymbolicLink()) {
          res.statusCode = 403;
          res.end("forbidden static path");
          return;
        }
      }
      const body = await readFile(file);
      res.statusCode = 200;
      res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()]);
      res.setHeader("Content-Length", body.byteLength);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", asset ? "public, max-age=31536000, immutable" : "no-cache");
      res.end(method === "HEAD" ? undefined : body);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(method === "HEAD" ? undefined : "not found");
        return;
      }
      throw error;
    }
  };
}
