// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAuthGate } from "./gate";
import { AuthSessionStore, type AuthSession } from "./sessionStore";
import type { AuthConfig } from "./config";
import type { OidcClient } from "./oidc";

const stores: AuthSessionStore[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture(
  validateSession?: (identity: unknown) => Promise<{ role: "viewer" | "editor" | null }>,
) {
  const now = 2_000_000;
  const sessions = new AuthSessionStore({
    path: ":memory:",
    secret: "x".repeat(32),
    now: () => now,
  });
  stores.push(sessions);
  const oidc = {
    refresh: vi.fn(async () => {
      throw new Error("network unavailable");
    }),
    revoke: vi.fn(),
  } as unknown as OidcClient;
  const config = {
    publicUrl: "https://kb.example",
    issuer: "https://iam.example",
    clientId: "kb",
    sessionSecret: "x".repeat(32),
    sessionTtlSeconds: 28800,
    sessionMaxSeconds: 604800,
    sessionRefreshSeconds: 900,
    rolesClaim: "roles",
    viewerRoles: ["viewer"],
    editorRoles: ["editor"],
  } as AuthConfig;
  const gate = createAuthGate({
    config,
    oidc,
    sessions,
    now: () => now,
    ...({ validateSession } as object),
  });
  const record = {
    sub: "alice",
    role: "editor",
    idToken: "synthetic-id",
    accessToken: "synthetic-access",
    authenticatedAt: 1000,
    renewal: { refreshToken: "synthetic-refresh", startedAt: 1_000_000, refreshedAt: 1_000_000 },
  };
  const id = sessions.create(record as AuthSession, 3600);
  async function request(path = "/web/auth/me") {
    const res = {
      statusCode: 200,
      body: "",
      headers: new Map(),
      setHeader(k: string, v: unknown) {
        this.headers.set(k, v);
      },
      end(v: string) {
        this.body = v;
      },
    };
    await gate.authorize(
      { url: path, method: "GET", headers: { cookie: `dikw_session=${id}` } } as IncomingMessage,
      res as unknown as ServerResponse,
    );
    return res;
  }
  return { sessions, id, oidc, record, request };
}
it("keeps the sealed renewable session on transient provider failure and reports 503", async () => {
  const f = fixture();
  const r = await f.request();
  expect(r.statusCode).toBe(503);
  expect(f.sessions.get(f.id)).not.toBeNull();
  expect(r.body).not.toContain("synthetic");
});
it("uses fresh application authorization on cached sessions without waiting for refresh", async () => {
  const validator = vi.fn(async () => ({ role: "viewer" as const }));
  const f = fixture(validator);
  f.sessions.update(f.id, { ...f.record, renewal: undefined } as AuthSession, 3_000_000);
  const r = await f.request();
  expect(r.statusCode).toBe(200);
  expect(JSON.parse(r.body).role).toBe("viewer");
  expect(validator).toHaveBeenCalledWith(
    expect.objectContaining({
      sub: "alice",
      accessToken: "synthetic-access",
      authenticatedAt: 1000,
    }),
  );
});
it("does not invent original login metadata for a legacy session", async () => {
  const validator = vi.fn(async () => ({ role: "editor" as const }));
  const f = fixture(validator);
  f.sessions.update(f.id, { sub: "alice", role: "editor", idToken: "legacy" }, 3_000_000);
  expect((await f.request()).statusCode).toBe(401);
  expect(validator).not.toHaveBeenCalled();
  expect(f.sessions.get(f.id)).toBeNull();
});
it("retains rotated refresh credentials if the later application status lookup is unavailable", async () => {
  const validator = vi.fn(async () => {
    throw new Error("network");
  });
  const f = fixture(validator);
  vi.mocked(f.oidc.refresh).mockResolvedValue({
    claims: { sub: "alice", roles: ["editor"] },
    refreshToken: "rotated-refresh",
    accessToken: "rotated-access",
  } as never);
  expect((await f.request()).statusCode).toBe(503);
  expect(f.sessions.get(f.id)?.renewal?.refreshToken).toBe("rotated-refresh");
  expect((f.sessions.get(f.id) as unknown as { authenticatedAt: number }).authenticatedAt).toBe(
    1000,
  );
});
it("never overwrites rotated credentials when a concurrent status check finishes late", async () => {
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const released = new Promise<void>((r) => {
    resume = r;
  });
  const validator = vi.fn(async () => {
    if (validator.mock.calls.length === 1) {
      entered();
      await released;
    }
    return { role: "viewer" as const };
  });
  const f = fixture(validator);
  f.sessions.update(
    f.id,
    { ...f.record, renewal: { ...f.record.renewal, refreshedAt: 2_000_000 } } as AuthSession,
    3_000_000,
  );
  const request = f.request();
  await started;
  f.sessions.update(
    f.id,
    {
      ...f.record,
      accessToken: "new-access",
      renewal: { ...f.record.renewal, refreshToken: "new-refresh", refreshedAt: 2_000_000 },
    } as AuthSession,
    3_000_000,
  );
  resume();
  expect((await request).statusCode).toBe(200);
  expect(f.sessions.get(f.id)?.accessToken).toBe("new-access");
  expect(f.sessions.get(f.id)?.renewal?.refreshToken).toBe("new-refresh");
  expect(validator).toHaveBeenCalledTimes(2);
});
