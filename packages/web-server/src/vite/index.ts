import type { Plugin } from "vite";
import { agentSidecarPlugin } from "../agent/vitePlugin.js";
import { webApiPlugin } from "../web/vitePlugin.js";
import {
  canonicalRequestUrl,
  isRequestAllowed,
  type ApplicationId,
  type ApplicationProfile,
} from "../runtime/profile.js";

/** Install the capability guard before Vite's Core proxy and both sidecars. */
export function createApplicationPlugins(
  options: { appId?: ApplicationId; profile?: ApplicationProfile } = {},
): Plugin[] {
  const profile = options.profile ?? "workbench";
  const appId = options.appId ?? (profile === "mbweb" ? "dikw-mbweb" : "dikw-web");
  if (
    !(["workbench", "mbweb"] as string[]).includes(profile) ||
    appId !== (profile === "mbweb" ? "dikw-mbweb" : "dikw-web")
  ) {
    throw new Error("appId and profile must identify the same application");
  }
  const guard: Plugin = {
    name: "dikw-application-profile",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (profile === "workbench") return next();
        const canonical = canonicalRequestUrl(req.url ?? "/");
        if (
          canonical &&
          isRequestAllowed(
            profile,
            req.method ?? "GET",
            new URL(canonical, "http://localhost").pathname,
          )
        ) {
          // Vite dispatches its /@vite, /@id and scoped-package resources by
          // their original spelling. Canonicalize only our API namespaces;
          // the capability check above still validates every request path.
          if (/^\/(?:v1|agent|web)(?:\/|$)/.test(canonical)) req.url = canonical;
          return next();
        }
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: {
              code: "capability_forbidden",
              message: "request is unavailable for this application",
            },
          }),
        );
      });
    },
  };
  return [guard, agentSidecarPlugin({ appId, profile }), webApiPlugin({ appId })];
}
