import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadBranding } from "./config/branding";
import { loadTelemetry } from "./config/telemetry";
import { initBrowserOtel } from "./telemetry/initBrowserOtel";
import "./styles.css";

// Browser RUM is opt-in (a `telemetry` block in /config.json). Fire-and-forget so
// it never blocks first render; it no-ops entirely — loading none of the OTel web
// SDK — when unconfigured.
void loadTelemetry().then(initBrowserOtel);

loadBranding().then((branding) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App branding={branding} />
    </StrictMode>,
  );
});
