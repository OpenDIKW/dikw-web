import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AuthRole } from "./roles.js";
import { createSealer, type Sealer } from "./seal.js";

/** What a signed-in browser session resolves to. */
export interface AuthSession {
  sub: string;
  name?: string;
  email?: string;
  /** `null` = signed in but mapped to no role (gets the 403 page). */
  role: AuthRole | null;
  /** Kept only as the `id_token_hint` for RP-initiated logout. */
  idToken: string;
}

export interface AuthSessionStoreOptions {
  /** sqlite file path, or `:memory:` for tests. */
  path: string;
  secret: string;
  now?: () => number;
}

/**
 * Server-side login sessions in a small sqlite file (Node's built-in
 * `node:sqlite`, so no extra native dependency). At rest it holds only the
 * SHA-256 of each opaque session id and the AES-256-GCM-sealed record — a leaked
 * file yields neither a usable cookie nor the identity / ID token. Rotating
 * `DIKW_WEB_SESSION_SECRET` therefore signs everyone out.
 */
export class AuthSessionStore {
  private readonly db: DatabaseSync;
  private readonly sealer: Sealer;
  private readonly now: () => number;
  // Prepared once: `get` runs on every authenticated request.
  private readonly sweep: StatementSync;
  private readonly insert: StatementSync;
  private readonly select: StatementSync;
  private readonly remove: StatementSync;

  constructor(options: AuthSessionStoreOptions) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS auth_sessions (" +
        "id_hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    this.sweep = this.db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?");
    this.insert = this.db.prepare(
      "INSERT INTO auth_sessions (id_hash, data, expires_at) VALUES (?, ?, ?)",
    );
    this.select = this.db.prepare("SELECT data, expires_at FROM auth_sessions WHERE id_hash = ?");
    this.remove = this.db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?");
    this.sealer = createSealer(options.secret, "session-record");
    this.now = options.now ?? Date.now;
  }

  /** Stores `session` for `ttlSeconds` and returns the opaque id for the cookie. */
  create(session: AuthSession, ttlSeconds: number): string {
    const now = this.now();
    this.sweep.run(now);
    const id = randomBytes(32).toString("base64url");
    this.insert.run(hashId(id), this.sealer.seal(session), now + ttlSeconds * 1000);
    return id;
  }

  get(id: string): AuthSession | null {
    const row = this.select.get(hashId(id)) as { data: string; expires_at: number } | undefined;
    if (!row) {
      return null;
    }
    if (row.expires_at <= this.now()) {
      this.delete(id);
      return null;
    }
    return this.sealer.open<AuthSession>(row.data);
  }

  delete(id: string): void {
    this.remove.run(hashId(id));
  }

  close(): void {
    this.db.close();
  }
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}
