import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StartupError } from "./components/StartupError";
import { MbApp } from "./mb/MbApp";
import { AuthContext, installUnauthorizedRedirect, loadAuth } from "./config/auth";
import { loadBranding, type Branding } from "./config/branding";
import { loadTelemetry } from "./config/telemetry";
import { initBrowserOtel } from "./telemetry/initBrowserOtel";
import "./styles.css";

// Browser RUM is opt-in (a `telemetry` block in /config.json). Fire-and-forget so
// it never blocks first render; it no-ops entirely — loading none of the OTel web
// SDK — when unconfigured.
void loadTelemetry().then(initBrowserOtel);

// One bundle, two front-ends picked by the URL hash:
//   #MB-Web       → the focused 论文知识库 (MbApp)
//   anything else → the original multi-page workbench (App: #chat / #base / …)
// App only ever rewrites its own legacy hash (query→chat); an unknown hash like
// #MB-Web is left untouched, so the two never fight over the URL.
const MB_HASH = "mb-web";

function isMbHash(): boolean {
  return window.location.hash.replace(/^#\/?/, "").toLowerCase() === MB_HASH;
}

function Root({ branding }: { branding: Branding }) {
  const [mb, setMb] = useState<boolean>(isMbHash);
  useEffect(() => {
    const onHash = () => setMb(isMbHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return mb ? <MbApp /> : <App branding={branding} />;
}

// Auth mode (issue #200) is learned from the server at boot; when it is on, any
// later 401 from /v1, /agent or /web sends the user back through sign-in. If the
// server can't say, show a retryable error rather than guessing auth is off.
const root = createRoot(document.getElementById("root")!);
void Promise.all([loadBranding(), loadAuth()]).then(
  ([branding, auth]) => {
    if (auth.enabled) {
      installUnauthorizedRedirect();
    }
    root.render(
      <StrictMode>
        <AuthContext.Provider value={auth}>
          <Root branding={branding} />
        </AuthContext.Provider>
      </StrictMode>,
    );
  },
  () => root.render(<StartupError />),
);
