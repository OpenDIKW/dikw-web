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
import { DikwClient, normalizeBaseUrl } from "./api/client";
import { AgentClient } from "./api/agentClient";
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
type NavLabelKey = keyof (typeof translations)["en"]["nav"];

const serverKey = "dikw-web.serverUrl";
const tokenKey = "dikw-web.token";
const defaultServerUrl = "http://127.0.0.1:8765";

type NavItem = { id: ViewId; labelKey: NavLabelKey; icon: typeof LayoutDashboard };
type NavGroupId = keyof (typeof translations)["en"]["navGroups"];

// PR2: Sidebar nav is now grouped so the eye gets a rhythmic break
// between the seven knowledge routes and the single System entry.
const navGroups: Array<{ id: NavGroupId; items: NavItem[] }> = [
  {
    id: "knowledge",
    items: [
      { id: "overview", labelKey: "overview", icon: LayoutDashboard },
      { id: "query", labelKey: "query", icon: MessageSquareText },
      { id: "retrieve", labelKey: "retrieve", icon: Search },
      { id: "wiki", labelKey: "wiki", icon: BookOpen },
      { id: "graph", labelKey: "graph", icon: Network },
      { id: "wisdom", labelKey: "wisdom", icon: Gem },
      { id: "tasks", labelKey: "tasks", icon: ListChecks }
    ]
  }
];

const settingsNavItem: NavItem = { id: "settings", labelKey: "settings", icon: Settings };
const allViewIds: ViewId[] = [
  ...navGroups.flatMap((group) => group.items.map((item) => item.id)),
  settingsNavItem.id
];

export function App() {
  const [activeView, setActiveView] = useState<ViewId>(() => viewFromHash());
  const [serverUrl, setServerUrl] = useState(() => sessionStorage.getItem(serverKey) ?? defaultServerUrl);
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? "");
  const [locale, setLocale] = useState<Locale>(() => readLocale());
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePreference()));
  const [wikiInitialPath, setWikiInitialPath] = useState<string | null>(null);
  const clientBaseUrl = normalizeBaseUrl(serverUrl) === defaultServerUrl ? "" : serverUrl;
  const client = useMemo(() => new DikwClient({ baseUrl: clientBaseUrl, token }), [clientBaseUrl, token]);
  const agentClient = useMemo(() => new AgentClient({ coreUrl: serverUrl, token }), [serverUrl, token]);
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
    setServerUrl(defaultServerUrl);
    setToken("");
  }

  const connectionTarget = serverUrl;
  const tokenConfigured = Boolean(token);
  const tokenStatus = tokenConfigured ? copy.connection.tokenConfigured : copy.connection.noToken;
  const activeLabel = copy.nav[activeView as NavLabelKey] ?? copy.nav.overview;

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

        {navGroups.map((group) => (
          <nav className="nav-list nav-main" aria-label={copy.navGroups[group.id]} key={group.id}>
            <div className="nav-group-label">{copy.navGroups[group.id]}</div>
            {group.items.map((item) => (
              <NavButton
                active={activeView === item.id}
                icon={item.icon}
                key={item.id}
                label={copy.nav[item.labelKey]}
                onClick={() => openView(item.id)}
              />
            ))}
          </nav>
        ))}

        <nav className="nav-list nav-footer" aria-label={copy.navGroups.system}>
          <div className="nav-group-label">{copy.navGroups.system}</div>
          <NavButton
            active={activeView === "settings"}
            icon={settingsNavItem.icon}
            label={copy.nav.settings}
            onClick={() => openView("settings")}
          />
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <nav className="topbar__crumb" aria-label="Breadcrumb">
            <span className="topbar__crumb-root">OpenDIKW</span>
            <span className="topbar__crumb-sep" aria-hidden="true">／</span>
            <span className="topbar__crumb-leaf">{activeLabel}</span>
          </nav>

          <div className="connection-chip" data-token={tokenConfigured ? "on" : "off"}>
            <span className="connection-chip__dot" aria-hidden="true" />
            <span className="connection-chip__url">{connectionTarget}</span>
            <span className="connection-chip__sep" aria-hidden="true">·</span>
            <span className="connection-chip__token">{tokenStatus}</span>
          </div>
        </header>

        <main className="content">
          {activeView === "overview" ? <OverviewPage client={client} locale={locale} /> : null}
          {activeView === "query" ? <QueryPage agentClient={agentClient} client={client} locale={locale} /> : null}
          {activeView === "retrieve" ? <RetrievePage client={client} locale={locale} /> : null}
          {activeView === "wiki" ? <WikiPage client={client} initialPath={wikiInitialPath} locale={locale} /> : null}
          {activeView === "graph" ? <GraphPage client={client} onOpenWikiPath={openWikiPath} locale={locale} /> : null}
          {activeView === "wisdom" ? <WisdomPage client={client} locale={locale} /> : null}
          {activeView === "tasks" ? <TasksPage client={client} locale={locale} /> : null}
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
      <Icon size={17} aria-hidden="true" />
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
