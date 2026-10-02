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

describe("createSealer", () => {
  it("round-trips a value and rejects tampering or the wrong key/purpose", () => {
    const sealer = createSealer(SECRET, "test");
    const sealed = sealer.seal({ marker: "plaintext-marker" });
    expect(sealer.open(sealed)).toEqual({ marker: "plaintext-marker" });
    expect(sealed).not.toContain("plaintext-marker");
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("plaintext-marker");

    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}${sealed.slice(-1)}`;
    expect(sealer.open(flipped)).toBeNull();
    expect(sealer.open("not-sealed")).toBeNull();
    expect(createSealer("y".repeat(32), "test").open(sealed)).toBeNull();
    expect(createSealer(SECRET, "other").open(sealed)).toBeNull();
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

  it("persists only a hash of the id and an encrypted record", async () => {
    await withDbFile(async (path) => {
      const store = new AuthSessionStore({ path, secret: SECRET });
      const id = store.create(session, 60);
      store.close();

      const raw = (await readFile(path)).toString("latin1");
      for (const plaintext of [id, session.sub, session.email!, session.idToken, "editor"]) {
        expect(raw).not.toContain(plaintext);
      }

      const reopened = new AuthSessionStore({ path, secret: SECRET });
      expect(reopened.get(id)).toEqual(session);
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
