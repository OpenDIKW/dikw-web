import { resolve } from "node:path";
import { DEFAULT_LISTEN_HOST, isLoopbackHost } from "@opendikw/web-server/runtime";

export interface StandaloneConfig {
  host: string;
  port: number;
  staticDir: string;
}

/**
 * Resolve standalone listen settings and enforce fail-closed auth policy before
 * binding a socket or initializing provider credentials.
 */
export function resolveStandaloneConfig(
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): StandaloneConfig {
  const rawHost = env.DIKW_WEB_HOST?.trim() || DEFAULT_LISTEN_HOST;
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  const port = Number(env.DIKW_WEB_PORT?.trim() || "4321");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invalid DIKW_WEB_PORT");
  }
  const isProduction = env.NODE_ENV?.trim().toLowerCase() === "production";
  const authMode = env.DIKW_WEB_AUTH_MODE?.trim().toLowerCase() ?? "";
  if (isProduction && authMode !== "oidc") {
    throw new Error("production workbench requires DIKW_WEB_AUTH_MODE=oidc");
  }
  if (!isLoopbackHost(host) && authMode !== "oidc") {
    throw new Error("non-loopback DIKW_WEB_HOST requires DIKW_WEB_AUTH_MODE=oidc");
  }
  const staticDir = resolve(cwd, env.DIKW_WEB_STATIC_DIR?.trim() || "dist");
  return { host, port, staticDir };
}
