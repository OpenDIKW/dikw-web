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
  const remember = localStorage.getItem(rememberKey) === "true";
  // Source the connection as a *unit* — never splice a remembered token onto a
  // different session URL. The live tab wins whenever it has a URL (the workbench
  // App writes one on mount, even the default), and its token is taken verbatim:
  // an absent session token means "no token", not "fall back to the remembered one".
  const sessionUrl = sessionStorage.getItem(serverKey);
  if (sessionUrl !== null) {
    return { serverUrl: sessionUrl, token: sessionStorage.getItem(tokenKey) ?? "", remember };
  }
  // Cold tab (no session connection): recover the remembered localStorage mirror
  // as a unit, otherwise the default.
  if (remember) {
    return {
      serverUrl: localStorage.getItem(serverKey) ?? defaultServerUrl,
      token: localStorage.getItem(tokenKey) ?? "",
      remember: true,
    };
  }
  return { serverUrl: defaultServerUrl, token: "", remember: false };
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
