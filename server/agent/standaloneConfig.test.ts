// @vitest-environment node
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStandaloneConfig } from "./standaloneConfig";

describe("resolveStandaloneConfig", () => {
  it("defaults listen host to 127.0.0.1 and port to 4321 outside production", () => {
    const config = resolveStandaloneConfig({}, "/app");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4321);
    expect(config.staticDir).toBe(resolve("/app", "dist"));
  });

  it.each([
    ["unset auth mode", { NODE_ENV: "production" }],
    ["case/whitespace NODE_ENV", { NODE_ENV: " Production " }],
    ["auth mode off", { NODE_ENV: "production", DIKW_WEB_AUTH_MODE: "off" }],
    ["loopback host in production", { NODE_ENV: "production", DIKW_WEB_HOST: "127.0.0.1" }],
    ["all-interfaces in production", { NODE_ENV: "production", DIKW_WEB_HOST: "0.0.0.0" }],
  ])("fails closed in production when %s", (_label, env) => {
    expect(() => resolveStandaloneConfig(env)).toThrow(/DIKW_WEB_AUTH_MODE=oidc/);
  });

  it("strips IPv6 brackets from loopback DIKW_WEB_HOST for net.Server.listen", () => {
    const config = resolveStandaloneConfig({ DIKW_WEB_HOST: "[::1]" }, "/app");
    expect(config.host).toBe("::1");
  });

  it.each(["0.0.0.0", "::", "[::]", "192.168.1.5", "10.0.0.2", "dikw.internal"])(
    "rejects non-loopback bind host %s without OIDC even outside production",
    (host) => {
      expect(() =>
        resolveStandaloneConfig({ DIKW_WEB_HOST: host, DIKW_WEB_AUTH_MODE: "off" }),
      ).toThrow(/DIKW_WEB_AUTH_MODE=oidc/);
    },
  );

  it("allows production and non-loopback binds when DIKW_WEB_AUTH_MODE=oidc", () => {
    const config = resolveStandaloneConfig(
      {
        NODE_ENV: "production",
        DIKW_WEB_HOST: "0.0.0.0",
        DIKW_WEB_PORT: "8080",
        DIKW_WEB_AUTH_MODE: "oidc",
      },
      "/app",
    );
    expect(config).toEqual({ host: "0.0.0.0", port: 8080, staticDir: resolve("/app", "dist") });
  });

  it("rejects an invalid DIKW_WEB_PORT", () => {
    expect(() => resolveStandaloneConfig({ DIKW_WEB_PORT: "0" })).toThrow(/DIKW_WEB_PORT/);
    expect(() => resolveStandaloneConfig({ DIKW_WEB_PORT: "70000" })).toThrow(/DIKW_WEB_PORT/);
  });
});
