// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultServerUrl } from "@opendikw/web-client/connection";
import { resolveDevProxyTarget } from "./vitePlugin";

describe("resolveDevProxyTarget", () => {
  it("returns a trimmed absolute http(s) URL", () => {
    expect(resolveDevProxyTarget("http://127.0.0.1:57609")).toBe("http://127.0.0.1:57609");
    expect(resolveDevProxyTarget("  https://core.example.com  ")).toBe("https://core.example.com");
  });

  it("returns undefined when unset or blank", () => {
    expect(resolveDevProxyTarget(undefined)).toBeUndefined();
    expect(resolveDevProxyTarget("")).toBeUndefined();
    expect(resolveDevProxyTarget("   ")).toBeUndefined();
  });

  it("returns undefined for a malformed target (missing scheme)", () => {
    expect(resolveDevProxyTarget("127.0.0.1:57609")).toBeUndefined();
  });

  it("returns undefined for a non-http(s) target", () => {
    expect(resolveDevProxyTarget("ftp://core.example.com")).toBeUndefined();
  });

  it("agentSidecarPlugin defaults devProxyTarget to defaultServerUrl when VITE_DIKW_PROXY_TARGET is unset", async () => {
    vi.resetModules();
    const createDefaultAgentHandler = vi.fn(async () =>
      Object.assign(
        async (_req: unknown, res: { end: (body?: string) => void }) => {
          res.end("ok");
        },
        { abort() {}, async close() {} },
      ),
    );
    vi.doMock("./http.js", () => ({ createDefaultAgentHandler }));
    try {
      const { agentSidecarPlugin } = await import("./vitePlugin");
      const plugin = agentSidecarPlugin();
      const configResolved = plugin.configResolved as (config: {
        root: string;
        env: Record<string, string | undefined>;
      }) => void;
      configResolved({ root: process.cwd(), env: {} });
      let mounted:
        ((req: unknown, res: unknown, next: (err?: unknown) => void) => Promise<void>) | undefined;
      const configureServer = plugin.configureServer as (server: {
        middlewares: {
          use: (
            path: string,
            fn: (req: unknown, res: unknown, next: (err?: unknown) => void) => Promise<void>,
          ) => void;
        };
      }) => void;
      configureServer({
        middlewares: {
          use: (_path, fn) => {
            mounted = fn;
          },
        },
      });
      await mounted!(
        { method: "GET", url: "/sessions", headers: {} },
        {
          statusCode: 200,
          on() {},
          end() {},
        },
        () => {},
      );
      expect(createDefaultAgentHandler).toHaveBeenCalledWith(
        process.cwd(),
        expect.objectContaining({ devProxyTarget: defaultServerUrl }),
      );
    } finally {
      vi.doUnmock("./http.js");
      vi.resetModules();
    }
  });
});
