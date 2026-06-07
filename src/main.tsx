import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadBranding } from "./config/branding";
import "./styles.css";

loadBranding().then((branding) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App branding={branding} />
    </StrictMode>,
  );
});
