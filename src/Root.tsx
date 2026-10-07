import { lazy, Suspense, useEffect, useState } from "react";
import { App } from "./App";
import { StartupError } from "./components/StartupError";
import {
  AuthContext,
  installUnauthorizedRedirect,
  loadAuth,
  type AuthState,
} from "@opendikw/web-ui/auth";
import { loadBranding, type Branding } from "./config/branding";

const startupBranding = loadBranding();

const LegacyMbMigration = lazy(() =>
  import("./migrations/LegacyMbMigration").then((module) => ({
    default: module.LegacyMbMigration,
  })),
);

function isLegacyMbHash(): boolean {
  return window.location.hash.replace(/^#\/?/, "").toLowerCase() === "mb-web";
}

let unauthorizedRedirectInstalled = false;

function WorkbenchEntry({ branding }: { branding: Branding | null }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAuth().then(
      (state) => {
        if (!active) return;
        if (state.enabled && !unauthorizedRedirectInstalled) {
          installUnauthorizedRedirect();
          unauthorizedRedirectInstalled = true;
        }
        setAuth(state);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (failed) return <StartupError />;
  if (!auth || !branding) return <main aria-busy="true" />;
  return (
    <AuthContext.Provider value={auth}>
      <App branding={branding} />
    </AuthContext.Provider>
  );
}

export function Root() {
  const legacy = isLegacyMbHash();
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    let active = true;
    void startupBranding.then((value) => {
      if (active) setBranding(value);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    // Switching application entries replaces the document: pending probes and
    // the workbench's global 401 handler cannot affect the local backup page.
    // Ordinary workbench hash navigation stays inside the existing SPA.
    const onHash = () => {
      if (isLegacyMbHash() !== legacy) window.location.reload();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [legacy]);
  if (legacy) {
    if (!branding) return <main aria-busy="true" />;
    return (
      <Suspense fallback={<main aria-busy="true" />}>
        <LegacyMbMigration mbWebUrl={branding.mbWebUrl} />
      </Suspense>
    );
  }
  return <WorkbenchEntry branding={branding} />;
}
