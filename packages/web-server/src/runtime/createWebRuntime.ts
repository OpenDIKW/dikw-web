import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDefaultAgentHandler, resolveSessionsDir } from "../agent/http.js";
import { createRequestRouter, type RequestRouterOptions } from "../agent/requestRouter.js";
import { createDefaultWebHandler } from "../web/http.js";
import { loadAuthConfig } from "../auth/config.js";
import {
  ModelResolutionError,
  safeModelError,
  type ModelResolver,
  type ModelFeature,
  type RequestModel,
  type RequestModelFor,
} from "./requestModel.js";
import { SessionValidationError } from "../auth/sessionValidation.js";
import type { SessionValidator, SessionIdentity } from "../auth/sessionValidation.js";
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
  /** Optional application-specific, live status check; server-only credentials. */
  validateSession?: SessionValidator;
  /** Trusted server-only resolver. Requires OIDC plus live session validation.
   * Never changes global configuration or stores credentials in chat history. */
  resolveModel?: ModelResolver;
}
export interface WebRuntime {
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
  /** For application-owned model routes; reuses the same complete auth gate.
   * Null means the gate already sent its rejection. Caller retains resource authorization. */
  withModelIdentity?<T>(
    req: IncomingMessage,
    res: ServerResponse,
    callback: (identity: Readonly<SessionIdentity>) => Promise<T>,
  ): Promise<T | null>;
  resolveModelFor?(
    req: IncomingMessage,
    res: ServerResponse,
    feature: ModelFeature,
    signal?: AbortSignal,
  ): Promise<RequestModel | null>;
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
  if (options.resolveModel && (!authConfig || !options.validateSession))
    throw new Error("request-scoped models require OIDC and live session validation");
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
  const shutdown = new AbortController();
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
          oidc: createOidcClient(authConfig, { signal: shutdown.signal }),
          sessions,
          validateSession: options.validateSession,
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
    const modelFor: RequestModelFor | undefined = options.resolveModel
      ? async (req, feature, signal) => {
          const identity = gate?.identityOf(req);
          if (!identity)
            throw new ModelResolutionError(401, "Please sign in again before using a model.");
          try {
            const resolved = await options.resolveModel!({
              request: req,
              identity,
              feature,
              signal: signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal,
            });
            if (
              !resolved ||
              typeof resolved.model !== "string" ||
              !resolved.model ||
              typeof resolved.complete !== "function"
            )
              throw new Error("invalid model resolver result");
            return {
              model: resolved.model,
              async complete(body, callSignal) {
                try {
                  callSignal?.throwIfAborted();
                  if (closed) throw new ModelResolutionError(503, "Application is closed.");
                  const freshIdentity = await gate!.modelIdentityFor(req, identity);
                  callSignal?.throwIfAborted();
                  return await resolved.complete(body, callSignal, freshIdentity);
                } catch (error) {
                  if (error instanceof SessionValidationError)
                    throw new ModelResolutionError(
                      error.status,
                      "Your sign-in or access has changed; sign in again before continuing.",
                    );
                  throw safeModelError(error);
                }
              },
            };
          } catch (error) {
            throw safeModelError(error);
          }
        }
      : undefined;
    agent = await createDefaultAgentHandler(cwd, {
      env,
      sessionsDir,
      appId: options.appId,
      profile: options.profile,
      subjectFor,
      modelFor,
      ...(authConfig
        ? {
            legacySessionsOwner: authConfig.legacySessionsOwner,
            serverCore: { coreUrl: authConfig.coreUrl, token: authConfig.serverToken },
          }
        : {}),
    });
    web = await createDefaultWebHandler(cwd, { env, appId: options.appId, subjectFor, modelFor });
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
      ...(modelFor
        ? {
            async withModelIdentity<T>(
              req: IncomingMessage,
              res: ServerResponse,
              callback: (identity: Readonly<SessionIdentity>) => Promise<T>,
            ): Promise<T | null> {
              if (closed) throw new ModelResolutionError(503, "Application is closed.");
              if (!(await gate!.authorize(req, res))) return null;
              const identity = gate!.identityOf(req);
              if (!identity)
                throw new ModelResolutionError(401, "Please sign in again before using a model.");
              try {
                return await callback(identity);
              } catch (error) {
                throw safeModelError(error);
              }
            },
            async resolveModelFor(
              req: IncomingMessage,
              res: ServerResponse,
              feature: ModelFeature,
              signal?: AbortSignal,
            ) {
              if (closed) throw new ModelResolutionError(503, "Application is closed.");
              if (!(await gate!.authorize(req, res))) return null;
              return modelFor(req, feature, signal);
            },
          }
        : {}),
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
          shutdown.abort();
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
    shutdown.abort();
    agent?.abort();
    await web?.close();
    await agent?.close();
    sessions?.close();
    throw error;
  }
}
