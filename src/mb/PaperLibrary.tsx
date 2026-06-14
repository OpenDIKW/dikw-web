import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, PencilLine, RotateCw, Upload, X } from "lucide-react";
import { DikwClientError, type DikwClient } from "../api/client";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { basename } from "../utils/format";
import type { DocumentRecord } from "../types";
import type { CurrentPaper } from "./MbApp";
import { STAGE_LABEL, type UploadStage } from "./upload";

export interface UploadItem {
  id: string;
  name: string;
  stage: UploadStage | "failed";
  pct: number;
  error?: string;
  /** Kept in memory so a failed row can be retried without re-picking. */
  file?: File;
}

interface Props {
  client: DikwClient;
  selectedPath: string | null;
  onSelect: (paper: CurrentPaper) => void;
  onPickClick: () => void;
  uploads: UploadItem[];
  onDismissUpload: (id: string) => void;
  onRetryUpload: (id: string) => void;
  reloadKey: number;
  /** Hidden (display:none) when the panel is collapsed — kept mounted so its
   *  loaded state isn't lost on collapse/expand. */
  hidden?: boolean;
}

// Local display-name overrides (path → custom name). dikw-web is read-only over
// core, so renaming a paper is a browser-side alias — it doesn't touch the
// source file — kept in localStorage like the notes.
const NAMES_KEY = "dikw-mb.paperNames";

function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Turn a failed library load into an actionable message: an empty/wrong token
// 401s (the common cold-open cause — issue #97), a network fault means the URL
// is unreachable. Either way the fix is in MB-Web's connection settings.
function connErrorMessage(err: unknown): string {
  if (err instanceof DikwClientError) {
    if (err.status === 401 || err.status === 403) {
      return `无法连接 dikw-core：鉴权失败（HTTP ${err.status}）。请在连接设置中填写正确的 Token。`;
    }
    return `论文库加载失败（HTTP ${err.status}）。请在连接设置中检查 Server URL 与 dikw-core 状态。`;
  }
  return "无法连接 dikw-core。请在连接设置中检查 Server URL 是否可达。";
}

export function PaperLibrary({
  client,
  selectedPath,
  onSelect,
  onPickClick,
  uploads,
  onDismissUpload,
  onRetryUpload,
  reloadKey,
  hidden,
}: Props) {
  const loadPages = useCallback(
    (signal: AbortSignal) =>
      client.get<DocumentRecord[]>("/v1/base/pages", { signal, params: { active: true } }),
    [client],
  );
  // reloadKey bumps after an upload completes so the new source appears.
  const pages = useAsyncResource(loadPages, [client, reloadKey]);
  const papers = (pages.data ?? []).filter((d) => d.layer === "source");
  // Uploads run sequentially (ingest+synth on core shouldn't overlap), so a
  // failed row's retry stays disabled while any other upload is still in flight.
  const uploadInFlight = uploads.some((u) => u.stage !== "failed");

  const [names, setNames] = useState<Record<string, string>>(() => loadNames());
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  }, [names]);

  const originalName = (d: DocumentRecord) => d.title || basename(d.path);
  const displayName = (d: DocumentRecord) => names[d.path]?.trim() || originalName(d);

  function startRename(path: string) {
    cancelledRef.current = false;
    setRenaming(path);
    requestAnimationFrame(() => {
      renameRef.current?.focus();
      renameRef.current?.select();
    });
  }

  function cancelRename() {
    cancelledRef.current = true;
    setRenaming(null);
  }

  function commitRename(d: DocumentRecord) {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const value = (renameRef.current?.value ?? "").trim();
    const original = originalName(d);
    setNames((prev) => {
      const next = { ...prev };
      // Empty or equal-to-original → drop the alias (fall back to the real name).
      if (!value || value === original) delete next[d.path];
      else next[d.path] = value;
      return next;
    });
    // Keep the open reader / Q&A / note-source title in sync with the rename.
    if (d.path === selectedPath) {
      onSelect({ path: d.path, title: value || original });
    }
    setRenaming(null);
  }

  return (
    <aside className={`mb-col mb-lib${hidden ? " mb-col--hidden" : ""}`}>
      <div className="mb-lib-head">论文库 · {papers.length}</div>
      <div className="mb-lib-list">
        {uploads.map((u) =>
          u.stage === "failed" ? (
            <div className="mb-paper proc is-failed" key={u.id}>
              <X className="mb-pico" size={15} aria-hidden="true" />
              <span className="mb-ptit">
                {u.name}
                <span className="mb-up-err">{u.error || "上传失败"}</span>
              </span>
              {u.file ? (
                <button
                  className="mb-pretry"
                  type="button"
                  aria-label="重试"
                  title={uploadInFlight ? "等待当前上传完成后重试" : "重试"}
                  disabled={uploadInFlight}
                  onClick={() => onRetryUpload(u.id)}
                >
                  <RotateCw size={13} aria-hidden="true" />
                </button>
              ) : null}
              <button
                className="mb-pdismiss"
                type="button"
                aria-label="移除"
                onClick={() => onDismissUpload(u.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="mb-paper proc" key={u.id}>
              <div className="mb-prog" style={{ width: `${u.pct}%` }} />
              <Loader2 className="mb-pico mb-spin" size={15} aria-hidden="true" />
              <span className="mb-ptit">{u.name}</span>
              <span className="mb-pstage">
                <Loader2 className="mb-spin" size={12} aria-hidden="true" />
                {STAGE_LABEL[u.stage]} {Math.round(u.pct)}%
              </span>
            </div>
          ),
        )}

        {pages.loading && !pages.data ? (
          <div className="mb-lib-empty">正在加载论文库…</div>
        ) : pages.error ? (
          <div className="mb-lib-empty mb-lib-err">
            <p>{connErrorMessage(pages.error)}</p>
            <button
              type="button"
              className="mb-btn"
              onClick={() => window.dispatchEvent(new CustomEvent("mb-open-settings"))}
            >
              连接设置
            </button>
          </div>
        ) : !papers.length && !uploads.length ? (
          <div className="mb-lib-empty">还没有论文。点下方上传，自动转换并入库。</div>
        ) : (
          papers.map((d) => {
            const on = d.path === selectedPath;
            if (renaming === d.path) {
              return (
                <div className={`mb-paper${on ? " on" : ""}`} key={d.path}>
                  <FileText className="mb-pico" size={15} aria-hidden="true" />
                  <input
                    ref={renameRef}
                    className="mb-rename-input"
                    defaultValue={displayName(d)}
                    aria-label="论文名称"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(d);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    onBlur={() => commitRename(d)}
                  />
                </div>
              );
            }
            return (
              <div
                key={d.path}
                className={`mb-paper${on ? " on" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect({ path: d.path, title: displayName(d) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect({ path: d.path, title: displayName(d) });
                  }
                }}
              >
                <FileText className="mb-pico" size={15} aria-hidden="true" />
                <span className="mb-ptit">{displayName(d)}</span>
                <button
                  className="mb-prename"
                  type="button"
                  aria-label="重命名"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(d.path);
                  }}
                >
                  <PencilLine size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
      <button
        className="mb-up"
        type="button"
        onClick={onPickClick}
        disabled={uploadInFlight}
        title={uploadInFlight ? "正在上传，请稍候…" : "上传论文"}
      >
        <Upload size={16} aria-hidden="true" />
        上传论文
      </button>
    </aside>
  );
}
