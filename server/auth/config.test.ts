// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "./config";

const SECRET = "s".repeat(32);

function oidcEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DIKW_WEB_AUTH_MODE: "oidc",
    DIKW_WEB_PUBLIC_URL: "https://kb.example.com",
    DIKW_WEB_OIDC_ISSUER: "https://iam.example.com",
    DIKW_WEB_OIDC_CLIENT_ID: "dikw-web",
    DIKW_WEB_OIDC_CLIENT_SECRET: "client-secret",
    DIKW_WEB_ROLE_VIEWER: "kb_viewer",
    DIKW_WEB_ROLE_EDITOR: "kb_editor",
    DIKW_WEB_SESSION_SECRET: SECRET,
    DIKW_CORE_URL: "http://dikw-core:8765/",
    DIKW_SERVER_TOKEN: "core-token",
    ...overrides,
  };
}

async function configError(cwd: string, env: Record<string, string | undefined>): Promise<Error> {
  try {
    await loadAuthConfig({ cwd, env });
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected loadAuthConfig to throw");
}

async function withCwd<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "dikw-auth-config-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("loadAuthConfig", () => {
  it("is off (null) when DIKW_WEB_AUTH_MODE is unset, blank or off", async () => {
    await withCwd(async (cwd) => {
      expect(await loadAuthConfig({ cwd, env: {} })).toBeNull();
      expect(await loadAuthConfig({ cwd, env: { DIKW_WEB_AUTH_MODE: " " } })).toBeNull();
      expect(await loadAuthConfig({ cwd, env: { DIKW_WEB_AUTH_MODE: "off" } })).toBeNull();
    });
  });

  it("rejects an unknown mode instead of silently running unauthenticated", async () => {
    await withCwd(async (cwd) => {
      await expect(loadAuthConfig({ cwd, env: { DIKW_WEB_AUTH_MODE: "saml" } })).rejects.toThrow(
        /DIKW_WEB_AUTH_MODE/,
      );
    });
  });

  it("parses a complete oidc config with defaults", async () => {
    await withCwd(async (cwd) => {
      const config = await loadAuthConfig({ cwd, env: oidcEnv() });
      expect(config).toEqual({
        publicUrl: "https://kb.example.com",
        issuer: "https://iam.example.com",
        clientId: "dikw-web",
        clientSecret: "client-secret",
        scopes: "openid profile email",
        rolesClaim: "roles",
        viewerRoles: ["kb_viewer"],
        editorRoles: ["kb_editor"],
        sessionSecret: SECRET,
        sessionTtlSeconds: 8 * 60 * 60,
        sessionMaxSeconds: 7 * 24 * 60 * 60,
        sessionRefreshSeconds: 15 * 60,
        coreUrl: "http://dikw-core:8765",
        serverToken: "core-token",
      });
    });
  });

  it("parses the optional knobs", async () => {
    await withCwd(async (cwd) => {
      const config = await loadAuthConfig({
        cwd,
        env: oidcEnv({
          DIKW_WEB_OIDC_INTERNAL_URL: "http://idp:8000",
          DIKW_WEB_OIDC_SCOPES: "openid profile",
          DIKW_WEB_OIDC_ROLES_CLAIM: "roles[].name",
          DIKW_WEB_OIDC_ROLES_OWNER: "my-org",
          DIKW_WEB_ROLE_VIEWER: "a, b ,,",
          DIKW_WEB_ROLE_EDITOR: "",
          DIKW_WEB_SESSION_TTL_SECONDS: "600",
          DIKW_WEB_SESSION_MAX_SECONDS: "7200",
          DIKW_WEB_SESSION_REFRESH_SECONDS: "120",
          DIKW_WEB_AUTH_LEGACY_SESSIONS_OWNER: "user-sub-1",
        }),
      });
      expect(config).toMatchObject({
        internalUrl: "http://idp:8000",
        scopes: "openid profile",
        rolesClaim: "roles[].name",
        rolesOwner: "my-org",
        viewerRoles: ["a", "b"],
        editorRoles: [],
        sessionTtlSeconds: 600,
        sessionMaxSeconds: 7200,
        sessionRefreshSeconds: 120,
        legacySessionsOwner: "user-sub-1",
      });
    });
  });

  it("accepts opt-in offline authorization parameters without overriding OIDC security fields", async () => {
    await withCwd(async (cwd) => {
      const config = await loadAuthConfig({
        cwd,
        env: oidcEnv({ DIKW_WEB_OIDC_AUTH_PARAMS: '{"access_type":"offline","prompt":"consent"}' }),
      });
      expect(config?.authorizationParams).toEqual({ access_type: "offline", prompt: "consent" });
      expect(config?.scopes).toBe("openid profile email");
      for (const value of [
        '{"nonce":"replayed"}',
        '{"scope":"offline_access"}',
        '{"prompt":false}',
        "[]",
        "not-json",
      ]) {
        await expect(
          loadAuthConfig({ cwd, env: oidcEnv({ DIKW_WEB_OIDC_AUTH_PARAMS: value }) }),
        ).rejects.toThrow(/DIKW_WEB_OIDC_AUTH_PARAMS/);
      }
    });
  });

  it("fails fast listing every missing required variable at once", async () => {
    await withCwd(async (cwd) => {
      const error = await configError(cwd, {
        DIKW_WEB_AUTH_MODE: "oidc",
        DIKW_WEB_OIDC_CLIENT_ID: "dikw-web",
      });
      for (const key of [
        "DIKW_WEB_PUBLIC_URL",
        "DIKW_WEB_OIDC_ISSUER",
        "DIKW_WEB_OIDC_CLIENT_SECRET",
        "DIKW_WEB_SESSION_SECRET",
        "DIKW_CORE_URL",
        "DIKW_SERVER_TOKEN",
      ]) {
        expect(error.message).toContain(key);
      }
      expect(error.message).not.toContain("DIKW_WEB_OIDC_CLIENT_ID");
    });
  });

  it("requires at least one role mapping", async () => {
    await withCwd(async (cwd) => {
      await expect(
        loadAuthConfig({
          cwd,
          env: oidcEnv({ DIKW_WEB_ROLE_VIEWER: "", DIKW_WEB_ROLE_EDITOR: " , " }),
        }),
      ).rejects.toThrow(/DIKW_WEB_ROLE_VIEWER.*DIKW_WEB_ROLE_EDITOR/);
    });
  });

  it.each([
    ["DIKW_WEB_PUBLIC_URL", "kb.example.com"],
    ["DIKW_WEB_PUBLIC_URL", "https://kb.example.com/app"],
    ["DIKW_WEB_OIDC_ISSUER", "iam.example.com"],
    ["DIKW_WEB_OIDC_INTERNAL_URL", "ftp://idp"],
    ["DIKW_CORE_URL", "dikw-core:8765"],
    ["DIKW_WEB_SESSION_SECRET", "too-short"],
    ["DIKW_WEB_SESSION_TTL_SECONDS", "0"],
    ["DIKW_WEB_SESSION_TTL_SECONDS", "8h"],
    ["DIKW_WEB_SESSION_MAX_SECONDS", "0"],
    ["DIKW_WEB_SESSION_REFRESH_SECONDS", "-1"],
  ])("rejects an invalid %s", async (key, value) => {
    await withCwd(async (cwd) => {
      const error = await configError(cwd, oidcEnv({ [key]: value }));
      expect(error.message).toContain(key);
      // Never echo a secret back into a startup log line.
      expect(error.message).not.toContain("too-short");
    });
  });

  it("reads .env.local, with explicit env taking precedence", async () => {
    await withCwd(async (cwd) => {
      await writeFile(
        join(cwd, ".env.local"),
        Object.entries(oidcEnv({ DIKW_WEB_OIDC_SCOPES: "openid file" }))
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
        "utf8",
      );
      const config = await loadAuthConfig({ cwd, env: { DIKW_WEB_OIDC_CLIENT_ID: "from-env" } });
      expect(config).toMatchObject({ clientId: "from-env", scopes: "openid file" });
    });
  });
});
