/** Server-only identity material for an application's live authorization check.
 * Never expose this object to clients, logs, traces or error messages. */
export interface SessionIdentity {
  issuer: string;
  clientId: string;
  sub: string;
  accessToken: string;
  /** Signed original login iat, seconds; refresh never changes it. */
  authenticatedAt: number;
}
export interface SessionAuthorization {
  role: "viewer" | "editor" | null;
}
export type SessionValidator = (
  identity: Readonly<SessionIdentity>,
) => Promise<SessionAuthorization>;
/** Only these safe statuses cross the public HTTP boundary. */
export class SessionValidationError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super(status === 503 ? "identity status unavailable" : "identity is no longer authorized");
  }
}
