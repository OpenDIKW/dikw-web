// Single source of truth for the dikw-core connection's storage keys + default.
//
// The workbench App owns the connection (Settings page writes it) and the
// MB-Web variant only reads it; both touch the SAME localStorage entries, so
// the keys must agree. Keeping them here — rather than re-declaring per file —
// guarantees that. localStorage (not sessionStorage) so the connection, once
// saved, survives a tab close / restart and is shared across tabs.
export const serverUrlStorageKey = "dikw-web.serverUrl";
export const tokenStorageKey = "dikw-web.token";
export const defaultServerUrl = "http://127.0.0.1:8765";
