import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDefaultAgentHandler, resolveSessionsDir } from "../agent/http.js";
import { createRequestRouter, type RequestRouterOptions } from "../agent/requestRouter.js";
import { createDefaultWebHandler } from "../web/http.js";
import { loadAuthConfig } from "../auth/config.js";
import { createAuthGate } from "../auth/gate.js";
import { createOidcClient } from "../auth/oidc.js";
import { AuthSessionStore } from "../auth/sessionStore.js";
import { createCoreProxy } from "../auth/coreProxy.js";
import { readEnvFile } from "../shared/env.js";
import { applicationContext, createLogger } from "../shared/logger.js";
import { createStaticHandler } from "./static.js";
import type { ApplicationId, ApplicationProfile } from "./profile.js";

export interface WebRuntimeOptions {
  appId: ApplicationId;
  profile: ApplicationProfile;
  cwd?: string;
  staticDir?: string;
  env?: Record<string, string | undefined>;
}
export interface WebRuntime {
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

/** Assemble resources without listening, installing signals, or changing app env. */
export function createWebRuntime(options: WebRuntimeOptions): Promise<WebRuntime> {
  return applicationContext.run(options.appId, () => assembleWebRuntime(options));
}

async function assembleWebRuntime(options: WebRuntimeOptions): Promise<WebRuntime> {
  if (
    !["workbench", "mbweb"].includes(options.profile) ||
    options.appId !== (options.profile === "mbweb" ? "dikw-mbweb" : "dikw-web")
  ) {
    throw new Error("appId and profile must identify the same application");
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = { ...(await readEnvFile(join(cwd, ".env.local"))), ...(options.env ?? process.env) };
  const coreId = env.DIKW_WEB_CORE_ID?.trim();
  if (options.profile === "mbweb" && env.NODE_ENV === "production" && !coreId) {
    throw new Error("production MB requires DIKW_WEB_CORE_ID");
  }
  const authConfig = await loadAuthConfig({ cwd, env });
  if (options.profile === "mbweb" && env.NODE_ENV === "production" && !authConfig) {
    throw new Error("production MB requires DIKW_WEB_AUTH_MODE=oidc");
  }
  if (options.profile === "mbweb" && authConfig && !coreId) {
    throw new Error("authenticated MB requires DIKW_WEB_CORE_ID");
  }
  const staticDir = resolve(cwd, options.staticDir ?? env.DIKW_WEB_STATIC_DIR?.trim() ?? "dist");
  if (!(await stat(join(staticDir, "index.html"))).isFile())
    throw new Error("static build missing index.html");
  const sessionsDir = resolveSessionsDir(cwd, env.DIKW_AGENT_SESSIONS_DIR ?? "");
  let sessions: AuthSessionStore | undefined;
  let agent: Awaited<ReturnType<typeof createDefaultAgentHandler>> | undefined;
  let web: Awaited<ReturnType<typeof createDefaultWebHandler>> | undefined;
  let proxy: ReturnType<typeof createCoreProxy> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const pending = new Set<Promise<void>>();
  const admitted = new Set<IncomingMessage>();
  const log = createLogger("server");
  try {
    let auth: RequestRouterOptions["auth"];
    if (authConfig) {
      await mkdir(sessionsDir, { recursive: true });
      sessions = new AuthSessionStore({
        path: join(sessionsDir, "auth.sqlite"),
        secret: authConfig.sessionSecret,
      });
      proxy = createCoreProxy({ coreUrl: authConfig.coreUrl, token: authConfig.serverToken });
      auth = {
        gate: createAuthGate({
          config: authConfig,
          oidc: createOidcClient(authConfig),
          sessions,
          ...(options.profile === "mbweb"
            ? ({
                cookiePrefix: "dikw_mbweb",
                publicIdentity: { issuer: authConfig.issuer, coreId: coreId! },
              } as const)
            : {}),
        }),
        coreProxy: proxy,
      };
    }
    const gate = auth?.gate;
    const subjectFor = gate ? (req: IncomingMessage) => gate.principalOf(req)!.sub : undefined;
    agent = await createDefaultAgentHandler(cwd, {
      env,
      sessionsDir,
      appId: options.appId,
      profile: options.profile,
      subjectFor,
      ...(authConfig
        ? {
            legacySessionsOwner: authConfig.legacySessionsOwner,
            serverCore: { coreUrl: authConfig.coreUrl, token: authConfig.serverToken },
          }
        : {}),
    });
    web = await createDefaultWebHandler(cwd, { env, appId: options.appId, subjectFor });
    const staticHandler = createStaticHandler(staticDir);
    const route = createRequestRouter({
      profile: options.profile,
      agent,
      web,
      auth,
      serveStatic: (req, res) =>
        staticHandler(
          req.method ?? "GET",
          new URL(req.url ?? "/", "http://localhost").pathname,
          req.headers.accept,
          res,
        ),
    });
    return {
      handler(req, res) {
        if (closed) {
          res.statusCode = 503;
          res.end("application is closed");
          return Promise.resolve();
        }
        admitted.add(req);
        const request = applicationContext.run(options.appId, () =>
          route(req, res).catch((error) => {
            log.error("request error", { error });
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
            }
            res.end("internal server error");
          }),
        );
        pending.add(request);
        void request.finally(() => {
          pending.delete(request);
          admitted.delete(req);
        });
        return request;
      },
      close() {
        closing ??= (async () => {
          closed = true;
          for (const req of admitted) {
            if (!req.complete) req.destroy();
          }
          agent!.abort();
          proxy?.abort();
          const jobs = web!.close();
          await Promise.allSettled([...pending]);
          try {
            await jobs;
            await agent!.close();
          } finally {
            sessions?.close();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    agent?.abort();
    await web?.close();
    await agent?.close();
    sessions?.close();
    throw error;
  }
}
