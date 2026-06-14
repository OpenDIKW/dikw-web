// dikw-core connection config for the MB-Web variant.
//
// MB-Web ships as a shareable link (`…/#MB-Web`), so it is routinely opened
// "cold" — in a fresh tab that never visited the workbench Settings. It reads
// the same `dikw-web.*` keys the workbench App writes, so a same-tab handoff
// (configure in App → switch to #MB-Web) keeps working; but it also falls back
// to a `localStorage` mirror so a cold-opened link can recover the connection,
// and exposes its own settings panel to set it. See issue #97.
//
// Security posture: `sessionStorage` (per-tab, cleared on close) stays the
// default home for the token, matching the workbench. The token only lands at
// rest in `localStorage` when the user opts in via "remember on this device".

export const serverKey = "dikw-web.serverUrl";
export const tokenKey = "dikw-web.token";
export const rememberKey = "dikw-mb.rememberConn";
export const defaultServerUrl = "http://127.0.0.1:8765";

export interface MbConnection {
  serverUrl: string;
  token: string;
  remember: boolean;
}

export function loadConnection(): MbConnection {
  // The live tab (and the workbench App in the same tab) wins; a remembered
  // localStorage mirror is the cold-open fallback.
  const serverUrl =
    sessionStorage.getItem(serverKey) ?? localStorage.getItem(serverKey) ?? defaultServerUrl;
  const token = sessionStorage.getItem(tokenKey) ?? localStorage.getItem(tokenKey) ?? "";
  const remember = localStorage.getItem(rememberKey) === "true";
  return { serverUrl, token, remember };
}

export function saveConnection(conn: MbConnection): void {
  // Always reflect the connection in the live tab (shared with the workbench).
  writeOrRemove(sessionStorage, serverKey, conn.serverUrl);
  writeOrRemove(sessionStorage, tokenKey, conn.token);

  // "Remember on this device" is the only path that writes the token at rest.
  // Turning it off wipes the mirror so a previously-saved token doesn't linger.
  if (conn.remember) {
    localStorage.setItem(rememberKey, "true");
    writeOrRemove(localStorage, serverKey, conn.serverUrl);
    writeOrRemove(localStorage, tokenKey, conn.token);
  } else {
    localStorage.removeItem(rememberKey);
    localStorage.removeItem(serverKey);
    localStorage.removeItem(tokenKey);
  }
}

function writeOrRemove(store: Storage, key: string, value: string): void {
  if (value) store.setItem(key, value);
  else store.removeItem(key);
}
