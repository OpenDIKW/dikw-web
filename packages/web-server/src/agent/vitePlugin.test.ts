// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { defaultServerUrl } from "@opendikw/web-client/connection";
import { agentSidecarPlugin, resolveDevProxyTarget } from "./vitePlugin";
import { webApiPlugin } from "../web/vitePlugin";

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

  it.each([true, "0.0.0.0", "::", "192.168.1.5"] as const)(
    "fails closed in both agentSidecarPlugin and webApiPlugin when Vite dev host is non-loopback (%s)",
    (host) => {
      for (const plugin of [agentSidecarPlugin(), webApiPlugin()]) {
        const configResolved = plugin.configResolved as (config: {
          root: string;
          command: "serve" | "build";
          server: { host?: string | boolean };
          env?: Record<string, string | undefined>;
        }) => void;
        expect(() =>
          configResolved({ root: process.cwd(), command: "serve", server: { host }, env: {} }),
        ).toThrow(/non-loopback Vite dev server host/i);
        // Production/library builds do not start a dev listener, so command: "build" is allowed.
        expect(() =>
          configResolved({ root: process.cwd(), command: "build", server: { host }, env: {} }),
        ).not.toThrow();
        const configureServer = plugin.configureServer as unknown as (server: {
          config: { server: { host?: string | boolean } };
          middlewares: { use: () => void };
        }) => void;
        expect(() =>
          configureServer({ config: { server: { host } }, middlewares: { use() {} } }),
        ).toThrow(/non-loopback Vite dev server host/i);
      }
    },
  );
});
