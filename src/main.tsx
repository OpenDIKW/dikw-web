import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { loadBranding } from "./config/branding";
import { loadTelemetry } from "./config/telemetry";
import { initBrowserOtel } from "./telemetry/initBrowserOtel";
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
import "@opendikw/web-ui/reader.css";
import "./styles.css";

void loadTelemetry().then(initBrowserOtel);
const startupBranding = loadBranding();

// The entry defines no component, so it never accepts its own HMR updates: a
// re-run would call createRoot() on #root again. Components live in ./Root.
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Root startupBranding={startupBranding} />
  </StrictMode>,
);
