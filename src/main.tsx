import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { loadTelemetry } from "./config/telemetry";
import { initBrowserOtel } from "./telemetry/initBrowserOtel";
import "@opendikw/web-ui/tokens.css";
import "@opendikw/web-ui/controls.css";
import "@opendikw/web-ui/reader.css";
import "./styles.css";

void loadTelemetry().then(initBrowserOtel);

// The entry defines no component, so it never accepts its own HMR updates. A
// re-run would call createRoot() on #root again (see main.test.ts).
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
