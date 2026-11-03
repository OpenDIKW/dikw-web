// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SessionValidationError, type SessionIdentity } from "@opendikw/web-server/runtime";
import { casdoorEnvironment, createCasdoorSessionValidator } from "./casdoor";

const env = {
  DIKW_WEB_AUTH_MODE: "oidc",
  DIKW_WEB_CASDOOR_LIVE_AUTH: "true",
  DIKW_WEB_IAM_STATUS_FIELDS_VERIFIED: "true",
  DIKW_WEB_OIDC_ISSUER: "https://iam.example",
  DIKW_WEB_OIDC_CLIENT_ID: "workbench",
  DIKW_WEB_OIDC_CLIENT_SECRET: "synthetic-client-secret",
  DIKW_WEB_OIDC_ROLES_OWNER: "fixture",
  DIKW_WEB_ROLE_EDITOR: "editor",
  DIKW_WEB_ROLE_VIEWER: "viewer",
};
const identity: SessionIdentity = {
  issuer: env.DIKW_WEB_OIDC_ISSUER,
  clientId: "workbench",
  sub: "synthetic-user",
  accessToken: "synthetic-access-token",
  authenticatedAt: 1_700_000_000,
};
function fixture(token: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  const fetcher = vi.fn<typeof fetch>();
  const active = {
    active: true,
    client_id: identity.clientId,
    iss: identity.issuer,
    sub: identity.sub,
    aud: [identity.clientId],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...token,
  };
  const account = {
    id: identity.sub,
    owner: "fixture",
    isForbidden: false,
    isDeleted: false,
    needUpdatePassword: false,
    lastChangePasswordTime: "",
    roles: [{ owner: "fixture", name: "editor", isEnabled: true }],
    ...user,
  };
  fetcher.mockImplementation(async (url) =>
    Response.json(
      new URL(String(url)).pathname.endsWith("introspect")
        ? active
        : { status: "ok", data: account },
    ),
  );
  return { fetcher, active, account, validate: createCasdoorSessionValidator(env, fetcher)! };
}

describe("explicit Casdoor startup contract", () => {
  it("keeps the shared runtime's literal dotenv credentials and environment precedence", () => {
    const value = casdoorEnvironment(
      '# comment\r\nDIKW_WEB_SESSION_SECRET=prefix#suffix\r\nDIKW_WEB_OIDC_CLIENT_SECRET="plus+/=secret"\r\nDIKW_WEB_ROLE_VIEWER=viewer\r\n',
      { DIKW_WEB_ROLE_VIEWER: "override" },
    );
    expect(value.DIKW_WEB_SESSION_SECRET).toBe("prefix#suffix");
    expect(value.DIKW_WEB_OIDC_CLIENT_SECRET).toBe("plus+/=secret");
    expect(value.DIKW_WEB_ROLE_VIEWER).toBe("override");
  });
  it("does not enable provider-specific behavior unless selected", () => {
    expect(createCasdoorSessionValidator({})).toBeUndefined();
    expect(createCasdoorSessionValidator({ DIKW_WEB_CASDOOR_LIVE_AUTH: "false" })).toBeUndefined();
  });
  it.each([
    ["DIKW_WEB_CASDOOR_LIVE_AUTH", "yes"],
    ["DIKW_WEB_AUTH_MODE", "off"],
    ["DIKW_WEB_IAM_STATUS_FIELDS_VERIFIED", "false"],
    ["DIKW_WEB_OIDC_CLIENT_ID", ""],
    ["DIKW_WEB_OIDC_CLIENT_SECRET", ""],
    ["DIKW_WEB_OIDC_ROLES_OWNER", ""],
    ["DIKW_WEB_OIDC_ISSUER", "https://iam.example/path"],
    ["DIKW_WEB_OIDC_ISSUER", "https://secret@iam.example"],
    ["DIKW_WEB_OIDC_INTERNAL_URL", "https://iam.example/?redirect=elsewhere"],
    ["DIKW_WEB_OIDC_INTERNAL_URL", "file:///tmp/iam"],
  ])("fails closed for invalid %s without echoing its value", (key, value) => {
    expect(() => createCasdoorSessionValidator({ ...env, [key]: value })).toThrow();
  });
});

it("uses only fixed endpoints at the configured back-channel origin and returns no identity material", async () => {
  const f = fixture();
  const validate = createCasdoorSessionValidator(
    { ...env, DIKW_WEB_OIDC_INTERNAL_URL: "http://127.0.0.1:8109" },
    f.fetcher,
  )!;
  expect(await validate(identity)).toEqual({ role: "editor" });
  const calls = f.fetcher.mock.calls;
  expect(calls.map(([url]) => new URL(String(url)).origin)).toEqual([
    "http://127.0.0.1:8109",
    "http://127.0.0.1:8109",
  ]);
  expect(calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/api/login/oauth/introspect",
    "/api/get-user",
  ]);
  expect(
    calls.every(
      ([, options]) => options?.redirect === "error" && options.signal instanceof AbortSignal,
    ),
  ).toBe(true);
  expect(new URLSearchParams(String(calls[0][1]?.body)).get("token")).toBe(identity.accessToken);
  expect(new URLSearchParams(String(calls[0][1]?.body)).get("client_id")).toBe(identity.clientId);
  expect(new URLSearchParams(String(calls[0][1]?.body)).get("client_secret")).toBe(
    env.DIKW_WEB_OIDC_CLIENT_SECRET,
  );
  expect(new Headers(calls[1][1]?.headers).get("Authorization")).toBe(
    `Bearer ${identity.accessToken}`,
  );
  expect(new URL(String(calls[1][0])).searchParams.get("userId")).toBe(identity.sub);
  expect(new URL(String(calls[1][0])).searchParams.get("owner")).toBe("fixture");
});
it("uses decoded form-post credentials supported by deployed Casdoor, including special secrets", async () => {
  const f = fixture();
  const validate = createCasdoorSessionValidator(
    { ...env, DIKW_WEB_OIDC_CLIENT_SECRET: "synthetic+/= secret" },
    f.fetcher,
  )!;
  expect(await validate(identity)).toEqual({ role: "editor" });
  const form = new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body));
  expect(form.get("client_secret")).toBe("synthetic+/= secret");
  expect(new Headers(f.fetcher.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
});

it.each([
  { issuer: "https://foreign.example" },
  { clientId: "other" },
  { sub: "" },
  { accessToken: "" },
  { authenticatedAt: 0 },
  { authenticatedAt: NaN },
])("rejects inconsistent sealed identity before any request: %j", async (change) => {
  const f = fixture();
  await expect(f.validate({ ...identity, ...change })).rejects.toMatchObject({ status: 401 });
  expect(f.fetcher).not.toHaveBeenCalled();
});

it.each([
  { active: false },
  { client_id: "other" },
  { iss: "https://foreign.example" },
  { sub: "other" },
  { aud: ["other"] },
  { exp: 1 },
])("denies a confirmed invalid introspected token: %j", async (token) => {
  const f = fixture(token);
  await expect(f.validate(identity)).rejects.toMatchObject({ status: 401 });
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  { active: "true" },
  { client_id: " " },
  { sub: " " },
  { iss: " " },
  { aud: [" "] },
  { client_id: null },
  { aud: null },
  { iss: undefined },
  { exp: "later" },
])("treats malformed provider evidence as unavailable, not permission: %j", async (token) => {
  await expect(fixture(token).validate(identity)).rejects.toMatchObject({ status: 503 });
});
it("accepts RFC 7662 string audience as well as Casdoor's array", async () => {
  expect(await fixture({ aud: identity.clientId }).validate(identity)).toEqual({ role: "editor" });
});
it.each([{ id: "other" }, { owner: "other" }])("rejects a different account: %j", async (user) => {
  await expect(fixture({}, user).validate(identity)).rejects.toMatchObject({ status: 401 });
});
it.each([{ isForbidden: true }, { isDeleted: true }, { needUpdatePassword: true }, { roles: [] }])(
  "denies current account restrictions: %j",
  async (user) => {
    await expect(fixture({}, user).validate(identity)).rejects.toMatchObject({ status: 403 });
  },
);
it("reads current enabled organization roles on every call", async () => {
  const f = fixture();
  expect(await f.validate(identity)).toEqual({ role: "editor" });
  f.account.roles = [
    { owner: "other", name: "editor", isEnabled: true },
    { owner: "fixture", name: "editor", isEnabled: false },
    { owner: "fixture", name: "viewer", isEnabled: true },
  ];
  expect(await f.validate(identity)).toEqual({ role: "viewer" });
  expect(f.fetcher).toHaveBeenCalledTimes(4);
});
it.each([
  { id: undefined },
  { id: " " },
  { owner: null },
  { owner: " " },
  { isForbidden: undefined },
  { needUpdatePassword: null },
  { isDeleted: "false" },
  { roles: "editor" },
  { roles: [null] },
  { lastChangePasswordTime: undefined },
  { lastChangePasswordTime: "yesterday" },
  { lastChangePasswordTime: "2023-11-14T22:13:19" },
])("retains sessions when required account evidence is unavailable: %j", async (user) => {
  await expect(fixture({}, user).validate(identity)).rejects.toMatchObject({ status: 503 });
});
it("compares password changes with immutable login iat, not a refreshed token's iat", async () => {
  const f = fixture(
    { iat: identity.authenticatedAt + 3600 },
    { lastChangePasswordTime: new Date(identity.authenticatedAt * 1000).toISOString() },
  );
  await expect(f.validate(identity)).rejects.toMatchObject({ status: 401 });
  f.account.lastChangePasswordTime = new Date(identity.authenticatedAt * 1000 - 1000).toISOString();
  expect(await f.validate(identity)).toEqual({ role: "editor" });
});
it.each(["network", "json", "introspection-auth", "redirect"])(
  "reports a safe retryable error for %s failure",
  async (failure) => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async () => {
      if (failure === "network") throw new Error(identity.accessToken);
      if (failure === "json") return new Response(identity.accessToken);
      return new Response(identity.accessToken, { status: failure === "redirect" ? 302 : 401 });
    });
    let error: unknown;
    try {
      await f.validate(identity);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessionValidationError);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain(identity.accessToken);
    expect(String(error)).not.toContain(env.DIKW_WEB_OIDC_CLIENT_SECRET);
  },
);
it("treats rejection of the account bearer credential as a terminal session", async () => {
  const f = fixture();
  f.fetcher
    .mockResolvedValueOnce(Response.json(f.active))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(f.validate(identity)).rejects.toMatchObject({ status: 401 });
});
