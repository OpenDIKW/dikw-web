// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createSealer } from "./seal";
import { AuthSessionStore, type AuthSession } from "./sessionStore";

const SECRET = "x".repeat(32);
const session: AuthSession = {
  sub: "user-1",
  name: "Ada",
  email: "ada@example.com",
  role: "editor",
  idToken: "header.payload.signature-of-ada",
};

function tamperCiphertext(sealed: string): string {
  return `${sealed.slice(0, -2)}${sealed.at(-2) === "A" ? "B" : "A"}${sealed.slice(-1)}`;
}

describe("createSealer", () => {
  it("round-trips a value and rejects tampering or the wrong key/purpose", () => {
    const sealer = createSealer(SECRET, "test");
    const sealed = sealer.seal({ marker: "plaintext-marker" });
    expect(sealer.open(sealed)).toEqual({ marker: "plaintext-marker" });
    expect(sealed).not.toContain("plaintext-marker");
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("plaintext-marker");

    const flipped = tamperCiphertext(sealed);
    expect(sealer.open(flipped)).toBeNull();
    expect(sealer.open("not-sealed")).toBeNull();
    expect(createSealer("y".repeat(32), "test").open(sealed)).toBeNull();
    expect(createSealer(SECRET, "other").open(sealed)).toBeNull();
  });

  it("rejects tampering when the original penultimate base64url character is A", () => {
    const sealer = createSealer(SECRET, "test");
    // Fixed IV 00000000000000000000006d: the ciphertext ends in Aq.
    const sealed = "AAAAAAAAAAAAAABteIhM8kIMkovc1vasv5PkTxRf54DtUkS0_kO1nEYV_5TlKRwxjkY2AoV7pkAq";
    expect(sealer.open(sealed)).toEqual({ marker: "plaintext-marker" });

    const flipped = tamperCiphertext(sealed);
    expect(flipped).not.toBe(sealed);
    expect(sealer.open(flipped)).toBeNull();
  });

  it("rejects a token whose tag was cut short instead of checking the shorter tag", async () => {
    const sealer = createSealer(SECRET, "test");
    const bytes = Buffer.from(sealer.seal({ sub: "u-1" }), "base64url");
    // 12-byte IV + only 4 bytes of the 16-byte tag. Without an explicit tag
    // length, Node would verify against those 4 bytes (and warn: DEP0182).
    const truncated = bytes.subarray(0, 16).toString("base64url");
    const warnings: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => warnings.push(warning.code ?? "");
    process.on("warning", onWarning);
    try {
      expect(sealer.open(truncated)).toBeNull();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings).not.toContain("DEP0182");
  });

  it("uses a fresh IV per seal", () => {
    const sealer = createSealer(SECRET, "test");
    expect(sealer.seal("same")).not.toBe(sealer.seal("same"));
  });
});

describe("AuthSessionStore", () => {
  it("creates, reads and deletes a session by its opaque id", () => {
    const store = new AuthSessionStore({ path: ":memory:", secret: SECRET });
    const id = store.create(session, 60);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.get(id)).toEqual(session);
    expect(store.get(`${id}x`)).toBeNull();
    store.delete(id);
    expect(store.get(id)).toBeNull();
  });

  it("expires sessions after their TTL", () => {
    let now = 1_000_000;
    const store = new AuthSessionStore({ path: ":memory:", secret: SECRET, now: () => now });
    const id = store.create(session, 60);
    now += 59_000;
    expect(store.get(id)).not.toBeNull();
    now += 1_000;
    expect(store.get(id)).toBeNull();
  });

  it("updates a live session with a stable id but never revives an expired or deleted session", () => {
    let now = 1_000_000;
    const store = new AuthSessionStore({ path: ":memory:", secret: SECRET, now: () => now });
    const id = store.create(session, 60);
    now += 59_000;
    const changed = { ...session, role: "viewer" as const };
    expect(store.update(id, changed, now + 60_000)).toBe(true);
    now += 59_000;
    expect(store.get(id)).toEqual(changed);
    now += 1_000;
    expect(store.update(id, session, now + 60_000)).toBe(false);
    expect(store.get(id)).toBeNull();
    const deleted = store.create(session, 60);
    store.delete(deleted);
    expect(store.update(deleted, session, now + 60_000)).toBe(false);
    expect(store.get(deleted)).toBeNull();
    store.close();
  });

  it("persists only a hash of the id and an encrypted record", async () => {
    await withDbFile(async (path) => {
      const store = new AuthSessionStore({ path, secret: SECRET });
      const renewable = {
        ...session,
        renewal: {
          refreshToken: "refresh-token-secret-marker",
          startedAt: Date.now(),
          refreshedAt: Date.now(),
        },
      };
      const id = store.create(renewable, 60);
      const rotated = {
        ...renewable,
        renewal: { ...renewable.renewal, refreshToken: "rotated-refresh-secret-marker" },
      };
      expect(store.update(id, rotated, Date.now() + 60_000)).toBe(true);
      store.close();

      const raw = (await readFile(path)).toString("latin1");
      for (const plaintext of [
        id,
        session.sub,
        session.email!,
        session.idToken,
        "editor",
        renewable.renewal.refreshToken,
        rotated.renewal.refreshToken,
      ]) {
        expect(raw).not.toContain(plaintext);
      }

      const reopened = new AuthSessionStore({ path, secret: SECRET });
      expect(reopened.get(id)).toEqual(rotated);
      reopened.close();
    });
  });

  it("treats sessions sealed under a rotated secret as signed out", async () => {
    await withDbFile(async (path) => {
      const store = new AuthSessionStore({ path, secret: SECRET });
      const id = store.create(session, 60);
      store.close();

      const rotated = new AuthSessionStore({ path, secret: "z".repeat(32) });
      expect(rotated.get(id)).toBeNull();
      rotated.close();
    });
  });

  it("sweeps expired rows when a new session is created", async () => {
    await withDbFile(async (path) => {
      let now = 0;
      const store = new AuthSessionStore({ path, secret: SECRET, now: () => now });
      store.create(session, 1);
      store.create(session, 1);
      now = 5_000;
      store.create(session, 60);
      store.close();

      const db = new DatabaseSync(path);
      const row = db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get() as { n: number };
      db.close();
      expect(row.n).toBe(1);
    });
  });
});

async function withDbFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "dikw-auth-store-"));
  try {
    await run(join(dir, "auth.sqlite"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
