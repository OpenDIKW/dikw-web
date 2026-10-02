import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Sealer {
  /** JSON-encode + AES-256-GCM encrypt; returns base64url(iv | tag | ciphertext). */
  seal(value: unknown): string;
  /** Decrypt + parse, or `null` when tampered, truncated, or sealed under another key. */
  open<T = unknown>(sealed: string): T | null;
}

/**
 * Authenticated encryption keyed off `DIKW_WEB_SESSION_SECRET`. Each `purpose`
 * (session records at rest, the in-flight login cookie) derives its own key via
 * HKDF, so a value sealed for one use can never be opened as another.
 */
export function createSealer(secret: string, purpose: string): Sealer {
  const key = Buffer.from(hkdfSync("sha256", secret, "dikw-web-auth", purpose, 32));
  return {
    seal(value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open<T>(sealed: string): T | null {
      try {
        const bytes = Buffer.from(sealed, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const plain = Buffer.concat([
          decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]);
        return JSON.parse(plain.toString("utf8")) as T;
      } catch {
        return null;
      }
    },
  };
}
