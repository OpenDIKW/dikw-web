import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Gem,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Network,
  Search
} from "lucide-react";
import { DikwClient } from "./api/client";
import { OverviewPage } from "./pages/OverviewPage";
import { QueryPage } from "./pages/QueryPage";
import { RetrievePage } from "./pages/RetrievePage";
import { TasksPage } from "./pages/TasksPage";
import { WikiPage } from "./pages/WikiPage";
import { WisdomPage } from "./pages/WisdomPage";

type ViewId = "overview" | "query" | "retrieve" | "wiki" | "wisdom" | "tasks";

const serverKey = "dikw-web.serverUrl";
const tokenKey = "dikw-web.token";

const navItems = [
  { id: "overview", labelZh: "概览", labelEn: "Overview", icon: LayoutDashboard },
  { id: "query", labelZh: "查询", labelEn: "Query", icon: MessageSquareText },
  { id: "retrieve", labelZh: "检索", labelEn: "Retrieve", icon: Search },
  { id: "wiki", labelZh: "知识库", labelEn: "Wiki", icon: BookOpen },
  { id: "wisdom", labelZh: "智慧", labelEn: "Wisdom", icon: Gem },
  { id: "tasks", labelZh: "任务", labelEn: "Tasks", icon: ListChecks }
] satisfies Array<{ id: ViewId; labelZh: string; labelEn: string; icon: typeof LayoutDashboard }>;

export function App() {
  const [activeView, setActiveView] = useState<ViewId>(() => viewFromHash());
  const [serverUrl, setServerUrl] = useState(() => sessionStorage.getItem(serverKey) ?? "");
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? "");
  const client = useMemo(() => new DikwClient({ baseUrl: serverUrl, token }), [serverUrl, token]);

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark">
            <img className="brand__logo" src="/opendikw-avatar.png" alt="OpenDIKW" />
          </div>
          <div>
            <strong>OpenDIKW</strong>
            <span>read console</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => openView(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="nav-item__label">
                  <strong>{item.labelZh}</strong>
                  <span>{item.labelEn}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="connection-label">
            <Network size={17} aria-hidden="true" />
            <span>{serverUrl || "same-origin /v1 proxy"}</span>
          </div>
          <div className="connection-form">
            <label className="field field--inline">
              <span>Server</span>
              <input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="同源代理，或 http://127.0.0.1:8765"
              />
            </label>
            <label className="field field--inline field--token">
              <span>Token</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Bearer token"
                type="password"
              />
            </label>
          </div>
        </header>

        <main className="content">
          {activeView === "overview" ? <OverviewPage client={client} /> : null}
          {activeView === "query" ? <QueryPage client={client} /> : null}
          {activeView === "retrieve" ? <RetrievePage client={client} /> : null}
          {activeView === "wiki" ? <WikiPage client={client} /> : null}
          {activeView === "wisdom" ? <WisdomPage client={client} /> : null}
          {activeView === "tasks" ? <TasksPage client={client} /> : null}
        </main>
      </div>
    </div>
  );
}

function viewFromHash(): ViewId {
  const value = window.location.hash.replace(/^#\/?/, "");
  return navItems.some((item) => item.id === value) ? (value as ViewId) : "overview";
}
