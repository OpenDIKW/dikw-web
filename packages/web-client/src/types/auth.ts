export type AuthRole = "viewer" | "editor";
export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}
export type AuthState =
  | { enabled: false }
  | { enabled: true; user: AuthUser; role: AuthRole; issuer?: string; coreId?: string };
