import { useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { defaultServerUrl, type MbConnection } from "./connection";

interface Props {
  serverUrl: string;
  token: string;
  remember: boolean;
  onSave: (next: MbConnection) => void;
  onClose: () => void;
}

// MB-Web's own connection panel — the workbench Settings page isn't reachable
// from #MB-Web, so a cold-opened link needs a way to set/recover Server URL +
// Token here (issue #97). Mirrors SettingsPage's connection fields.
export function MbConnectionPanel({ serverUrl, token, remember, onSave, onClose }: Props) {
  // Seeded once from props; the panel is a short-lived modal, so it never needs
  // to re-sync if the underlying connection changes while it's open.
  const [url, setUrl] = useState(serverUrl);
  const [tok, setTok] = useState(token);
  const [keep, setKeep] = useState(remember);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    // A blank URL would leave the client pointing nowhere; fall back to the
    // documented default (same-origin proxy) rather than persist an empty one.
    const trimmed = url.trim();
    onSave({ serverUrl: trimmed || defaultServerUrl, token: tok.trim(), remember: keep });
    onClose();
  }

  return (
    <div className="mb-confirm-backdrop" onClick={onClose} role="presentation">
      <div
        className="mb-confirm mb-conn"
        role="dialog"
        aria-modal="true"
        aria-label="连接设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-confirm-h mb-conn-h">
          <PlugZap size={18} aria-hidden="true" />
          连接设置
        </div>
        <p className="mb-conn-hint">
          填写 dikw-core 的地址与令牌。地址需同时能被浏览器与内置 sidecar 访问到。
        </p>

        <label className="mb-conn-field">
          <span>Server URL</span>
          <input
            aria-label="Server URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={defaultServerUrl}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className="mb-conn-field">
          <span>Token</span>
          <input
            aria-label="Token"
            type="password"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            placeholder="dikw-core Bearer token"
            autoComplete="off"
          />
        </label>

        <label className="mb-conn-remember">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>在本机记住连接（含令牌）</span>
        </label>
        <p className="mb-conn-note">
          关闭时连接仅存于当前标签页；开启后会写入本机
          localStorage，关闭标签页或重启浏览器后仍可用——令牌会落盘，仅在你信任的设备上开启。
        </p>

        <div className="mb-pop-act mb-conn-act">
          <button type="button" className="mb-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="mb-btn pri" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
