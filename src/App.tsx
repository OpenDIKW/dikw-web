import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Gem,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Network,
  Search,
  Settings
} from "lucide-react";
import { DikwClient } from "./api/client";
import {
  isLocale,
  isThemePreference,
  localeStorageKey,
  themeStorageKey,
  translations,
  type Locale,
  type ResolvedTheme,
  type ThemePreference
} from "./i18n";
import { OverviewPage } from "./pages/OverviewPage";
import { GraphPage } from "./pages/GraphPage";
import { QueryPage } from "./pages/QueryPage";
import { RetrievePage } from "./pages/RetrievePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { WikiPage } from "./pages/WikiPage";
import { WisdomPage } from "./pages/WisdomPage";

type ViewId = "overview" | "query" | "retrieve" | "wiki" | "graph" | "wisdom" | "tasks" | "settings";

const serverKey = "dikw-web.serverUrl";
const tokenKey = "dikw-web.token";

const navItems = [
  { id: "overview", labelKey: "overview", icon: LayoutDashboard },
  { id: "query", labelKey: "query", icon: MessageSquareText },
  { id: "retrieve", labelKey: "retrieve", icon: Search },
  { id: "wiki", labelKey: "wiki", icon: BookOpen },
  { id: "graph", labelKey: "graph", icon: Network },
  { id: "wisdom", labelKey: "wisdom", icon: Gem },
  { id: "tasks", labelKey: "tasks", icon: ListChecks }
] satisfies Array<{ id: ViewId; labelKey: keyof (typeof translations)["en"]["nav"]; icon: typeof LayoutDashboard }>;

const settingsNavItem = { id: "settings" as const, labelKey: "settings" as const, icon: Settings };
const allViewIds = [...navItems.map((item) => item.id), settingsNavItem.id];

export function App() {
  const [activeView, setActiveView] = useState<ViewId>(() => viewFromHash());
  const [serverUrl, setServerUrl] = useState(() => sessionStorage.getItem(serverKey) ?? "");
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? "");
  const [locale, setLocale] = useState<Locale>(() => readLocale());
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()));
  const [wikiInitialPath, setWikiInitialPath] = useState<string | null>(null);
  const client = useMemo(() => new DikwClient({ baseUrl: serverUrl, token }), [serverUrl, token]);
  const copy = translations[locale];

  useEffect(() => {
    if (serverUrl) {
      sessionStorage.setItem(serverKey, serverUrl);
    } else {
      sessionStorage.removeItem(serverKey);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem(tokenKey, token);
    } else {
      sessionStorage.removeItem(tokenKey);
    }
  }, [token]);

  useEffect(() => {
    localStorage.setItem(localeStorageKey, locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem(themeStorageKey, theme);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const nextTheme = resolveTheme(theme);
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
    };

    applyTheme();
    if (theme !== "system" || !media) {
      return;
    }

    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    function syncFromHash() {
      setActiveView(viewFromHash());
    }
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function openView(view: ViewId) {
    setActiveView(view);
    window.location.hash = view;
  }

  function openWikiPath(path: string) {
    setWikiInitialPath(path);
    openView("wiki");
  }

  function clearConnection() {
    setServerUrl("");
    setToken("");
  }

  const connectionTarget = serverUrl ? `${copy.connection.customServer}: ${serverUrl}` : copy.connection.sameOrigin;
  const tokenStatus = token ? copy.connection.tokenConfigured : copy.connection.noToken;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">
            <img className="brand__logo" src="/opendikw-avatar.png" alt="OpenDIKW" />
          </div>
          <div>
            <strong>OpenDIKW</strong>
            <span>{copy.brandSubtitle}</span>
          </div>
        </div>

        <nav className="nav-list nav-main" aria-label="Primary">
          {navItems.map((item) => (
            <NavButton
              active={activeView === item.id}
              icon={item.icon}
              key={item.id}
              label={copy.nav[item.labelKey]}
              onClick={() => openView(item.id)}
            />
          ))}
        </nav>

        <nav className="nav-list nav-footer" aria-label="Settings">
          <NavButton
            active={activeView === "settings"}
            icon={settingsNavItem.icon}
            label={copy.nav.settings}
            onClick={() => openView("settings")}
          />
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar topbar--status-only">
          <div className="connection-label connection-status">
            <Network size={17} aria-hidden="true" />
            <span className="connection-label__main">{connectionTarget}</span>
            <span className="connection-label__meta">{tokenStatus}</span>
          </div>
        </header>

        <main className="content">
          {activeView === "overview" ? <OverviewPage client={client} /> : null}
          {activeView === "query" ? <QueryPage client={client} /> : null}
          {activeView === "retrieve" ? <RetrievePage client={client} /> : null}
          {activeView === "wiki" ? <WikiPage client={client} initialPath={wikiInitialPath} /> : null}
          {activeView === "graph" ? <GraphPage client={client} onOpenWikiPath={openWikiPath} /> : null}
          {activeView === "wisdom" ? <WisdomPage client={client} /> : null}
          {activeView === "tasks" ? <TasksPage client={client} /> : null}
          {activeView === "settings" ? (
            <SettingsPage
              locale={locale}
              theme={theme}
              resolvedTheme={resolvedTheme}
              serverUrl={serverUrl}
              token={token}
              onLocaleChange={setLocale}
              onThemeChange={setTheme}
              onServerUrlChange={setServerUrl}
              onTokenChange={setToken}
              onClearConnection={clearConnection}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <Icon size={18} aria-hidden="true" />
      <span className="nav-item__label">
        <strong>{label}</strong>
      </span>
    </button>
  );
}

function readLocale(): Locale {
  const value = localStorage.getItem(localeStorageKey);
  return isLocale(value) ? value : "en";
}

function readThemePreference(): ThemePreference {
  const value = localStorage.getItem(themeStorageKey);
  return isThemePreference(value) ? value : "system";
}

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function viewFromHash(): ViewId {
  const value = window.location.hash.replace(/^#\/?/, "");
  return allViewIds.some((id) => id === value) ? (value as ViewId) : "overview";
}
