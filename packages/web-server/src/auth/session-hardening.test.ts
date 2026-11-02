import { SessionValidationError } from "./sessionValidation";
// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAuthGate } from "./gate";
import { AuthSessionStore, type AuthSession } from "./sessionStore";
import type { AuthConfig } from "./config";
import { OidcRefreshPendingError, type OidcClient } from "./oidc";

const stores: AuthSessionStore[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function fixture(
  validateSession?: (identity: unknown) => Promise<{ role: "viewer" | "editor" | null }>,
) {
  let now = 2_000_000;
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
  return {
    sessions,
    id,
    oidc,
    record,
    request,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
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
it("does not roll credentials back when rotation lands between validation and the idle update", async () => {
  let armed = false,
    rotated = false;
  const f = fixture(async () => {
    armed = true;
    return { role: "viewer" };
  });
  const record = {
    ...f.record,
    renewal: { ...f.record.renewal, refreshedAt: 2_000_000 },
  } as AuthSession;
  f.sessions.update(f.id, record, 3_000_000);
  const get = f.sessions.get.bind(f.sessions);
  vi.spyOn(f.sessions, "get").mockImplementation((id) => {
    const value = get(id);
    if (armed && !rotated) {
      rotated = true;
      queueMicrotask(() =>
        f.sessions.update(
          id,
          {
            ...record,
            accessToken: "race-access",
            renewal: { ...record.renewal!, refreshToken: "race-refresh" },
          },
          3_000_000,
        ),
      );
    }
    return value;
  });
  expect((await f.request()).statusCode).toBe(503);
  expect(get(f.id)?.accessToken).toBe("race-access");
  expect(get(f.id)?.renewal?.refreshToken).toBe("race-refresh");
});
it.each([undefined, 401, 403] as const)(
  "does not let a late live check authorize or delete a pending identity refresh (%s)",
  async (status) => {
    const f = fixture(async () => {
      markPending();
      if (status) throw new SessionValidationError(status);
      return { role: "editor" };
    });
    const record = {
      ...f.record,
      renewal: { ...f.record.renewal, refreshedAt: 2_000_000 },
    } as AuthSession;
    f.sessions.update(f.id, record, 3_000_000);
    const markPending = () =>
      f.sessions.update(
        f.id,
        {
          ...record,
          renewal: {
            ...record.renewal!,
            refreshToken: "unverified-rotation",
            identityPending: true,
          },
        },
        3_000_000,
      );
    expect((await f.request()).statusCode).toBe(503);
    expect(f.sessions.get(f.id)?.renewal?.identityPending).toBe(true);
  },
);
it("saves pending credentials without extending an idle deadline or reviving deleted records", () => {
  let clock = 1000;
  const store = new AuthSessionStore({
    path: ":memory:",
    secret: "s".repeat(32),
    now: () => clock,
  });
  stores.push(store);
  const record = { sub: "alice", role: "editor" as const, idToken: "fixture" };
  const id = store.create(record, 1);
  clock = 1500;
  expect(store.update(id, { ...record, accessToken: "pending" })).toBe(true);
  clock = 2000;
  expect(store.get(id)).toBeNull();
  expect(store.update(id, record)).toBe(false);
});
it("renews a short-lived access token before live validation even before the configured interval", async () => {
  const validator = vi.fn(async () => ({ role: "viewer" as const }));
  const f = fixture(validator);
  f.sessions.update(
    f.id,
    {
      ...f.record,
      accessTokenExpiresAt: 1_999_000,
      renewal: { ...f.record.renewal, refreshedAt: 1_950_000 },
    } as AuthSession,
    3_000_000,
  );
  vi.mocked(f.oidc.refresh).mockResolvedValue({
    claims: { sub: "alice", roles: ["viewer"] },
    refreshToken: "fresh-rt",
    accessToken: "fresh-access",
    accessTokenExpiresIn: 300,
  } as never);
  expect((await f.request()).statusCode).toBe(200);
  expect(f.oidc.refresh).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalledWith(
    expect.objectContaining({ accessToken: "fresh-access", authenticatedAt: 1000 }),
  );
  expect(f.sessions.get(f.id)?.accessTokenExpiresAt).toBe(2_300_000);
});

it.each(["logout", "expiry"])(
  "revokes a late pending refresh after %s without reviving the session",
  async (reason) => {
    let started!: () => void;
    let finish!: (error: Error) => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = fixture();
    vi.mocked(f.oidc.refresh).mockImplementation(() => {
      started();
      return new Promise((_, reject) => {
        finish = reject;
      });
    });
    const request = f.request();
    await entered;
    if (reason === "logout") f.sessions.delete(f.id);
    else f.advance(3_600_001);
    finish(new OidcRefreshPendingError("late-rotated-refresh"));
    expect((await request).statusCode).toBe(503);
    expect(f.sessions.get(f.id)).toBeNull();
    expect(f.oidc.revoke).toHaveBeenCalledWith("late-rotated-refresh");
  },
);
