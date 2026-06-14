import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MbApp } from "./mb/MbApp";
import { loadBranding, type Branding } from "./config/branding";
import "./styles.css";

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

loadBranding().then((branding) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root branding={branding} />
    </StrictMode>,
  );
});
