// dikw-core connection config for the MB-Web variant — read-only.
//
// MB-Web ships as a shareable link (`…/#MB-Web`), routinely opened "cold" in a
// fresh tab. The connection now lives in `localStorage` (written by the
// workbench Settings page, which MB-Web's gear navigates to), so it is shared
// across tabs and survives a restart — a cold-opened link connects without any
// per-tab handoff. MB-Web therefore only *reads* the connection; it no longer
// owns a settings panel of its own. See issue #97 and the unified-connection
// settings change.
import { defaultServerUrl, serverUrlStorageKey, tokenStorageKey } from "../config/connection";

export { defaultServerUrl };
export const serverKey = serverUrlStorageKey;
export const tokenKey = tokenStorageKey;

export interface MbConnection {
  serverUrl: string;
  token: string;
}

export function loadConnection(): MbConnection {
  return {
    serverUrl: localStorage.getItem(serverKey) ?? defaultServerUrl,
    token: localStorage.getItem(tokenKey) ?? "",
  };
}
