import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import type { DikwClient } from "../api/client";
import type { AgentClient } from "../api/agentClient";
import type { TranslateCache } from "../utils/translate";
import { MINERU_EXTENSIONS, tryOpenDefaultCache, type ConvertCache } from "../utils/mineru-convert";
import { lowerExt } from "../utils/import-bundle";
import type { CurrentPaper } from "./MbApp";
import { friendlyUploadError, uploadPaper, type UploadStage } from "./upload";
import { PaperLibrary, type UploadItem } from "./PaperLibrary";
import { PaperReader } from "./PaperReader";
import { QaPanel } from "./QaPanel";

interface Props {
  client: DikwClient;
  agentClient: AgentClient;
  assetBaseUrl: string;
  assetToken: string;
  translatorEnabled: boolean;
  translateCache: TranslateCache | null;
  onCurrentPaperChange: (paper: CurrentPaper | null) => void;
  /** Save a whole Q&A answer to 我的笔记 (and mirror to the Wisdom layer). */
  onSaveAnswer?: (text: string) => void;
}

const LIB_W_KEY = "dikw-mb.libW";
const QA_W_KEY = "dikw-mb.qaW";
const LEFT_KEY = "dikw-mb.leftCollapsed";
const RIGHT_KEY = "dikw-mb.rightCollapsed";
const LIB_MIN = 200;
const LIB_MAX = 460;
const LIB_DEFAULT = 268;
const QA_MIN = 300;
const QA_MAX = 560;
const QA_DEFAULT = 372;
const STEP = 16;
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}
function readWidth(key: string, def: number, min: number, max: number): number {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : def;
}
function readBool(key: string): boolean {
  return localStorage.getItem(key) === "true";
}
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `u-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
function emitToast(msg: string): void {
  window.dispatchEvent(new CustomEvent("mb-toast", { detail: msg }));
}

export function ResearchWorkspace({
  client,
  agentClient,
  assetBaseUrl,
  assetToken,
  translatorEnabled,
  translateCache,
  onCurrentPaperChange,
  onSaveAnswer,
}: Props) {
  const [paper, setPaper] = useState<CurrentPaper | null>(null);
  const [libW, setLibW] = useState(() => readWidth(LIB_W_KEY, LIB_DEFAULT, LIB_MIN, LIB_MAX));
  const [qaW, setQaW] = useState(() => readWidth(QA_W_KEY, QA_DEFAULT, QA_MIN, QA_MAX));
  const [leftCollapsed, setLeftCollapsed] = useState(() => readBool(LEFT_KEY));
  const [rightCollapsed, setRightCollapsed] = useState(() => readBool(RIGHT_KEY));
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragRef = useRef<{ side: "left" | "right"; startX: number; startW: number } | null>(null);

  // Narrow viewports can't fit three side-by-side panels; below 900px a single
  // panel fills the width and a tab bar switches between them, so the library
  // (paper picker) and Q&A stay reachable instead of being display:none'd away
  // — the #MB-Web link is a cold-open, phone-shared entry point. matchMedia is
  // absent in jsdom, so this defaults to the desktop three-pane layout.
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia?.("(max-width: 900px)").matches ?? false,
  );
  const [mobilePanel, setMobilePanel] = useState<"lib" | "reader" | "qa">("lib");
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq) return undefined;
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ── upload state ─────────────────────────────────────────────────────────
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [libReloadKey, setLibReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef<ConvertCache | null | undefined>(undefined);

  useEffect(() => localStorage.setItem(LIB_W_KEY, String(libW)), [libW]);
  useEffect(() => localStorage.setItem(QA_W_KEY, String(qaW)), [qaW]);
  useEffect(() => localStorage.setItem(LEFT_KEY, String(leftCollapsed)), [leftCollapsed]);
  useEffect(() => localStorage.setItem(RIGHT_KEY, String(rightCollapsed)), [rightCollapsed]);

  useEffect(() => {
    if (!dragging) return undefined;
    document.body.classList.add("mb-col-resizing");
    return () => document.body.classList.remove("mb-col-resizing");
  }, [dragging]);

  const selectPaper = useCallback(
    (p: CurrentPaper) => {
      setPaper(p);
      // On a phone, picking a paper jumps straight to reading it.
      setMobilePanel("reader");
      onCurrentPaperChange(p);
    },
    [onCurrentPaperChange],
  );

  const triggerPick = useCallback(() => fileInputRef.current?.click(), []);

  const runUpload = useCallback(
    async (file: File) => {
      const id = newId();
      setUploads((u) => [...u, { id, name: file.name, stage: "converting", pct: 4, file }]);
      const cache =
        cacheRef.current === undefined
          ? (cacheRef.current = await tryOpenDefaultCache())
          : cacheRef.current;
      const needsConvert = MINERU_EXTENSIONS.has(lowerExt(file.name));
      try {
        const res = await uploadPaper(client, file, {
          cache: needsConvert ? cache : null,
          translateCache,
          onProgress: (p) =>
            setUploads((u) =>
              u.map((x) => (x.id === id ? { ...x, stage: p.stage, pct: p.pct } : x)),
            ),
        });
        setUploads((u) => u.filter((x) => x.id !== id));
        setLibReloadKey((k) => k + 1);
        if (res.sourcePath) selectPaper({ path: res.sourcePath, title: res.title });
        emitToast(`《${res.title}》已分析完成`);
      } catch (e) {
        const msg = friendlyUploadError(e);
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, stage: "failed", error: msg } : x)));
      }
    },
    [client, selectPaper, translateCache],
  );

  const retryUpload = useCallback(
    (id: string) => {
      const item = uploads.find((x) => x.id === id);
      setUploads((u) => u.filter((x) => x.id !== id));
      if (item?.file) void runUpload(item.file);
    },
    [uploads, runUpload],
  );

  const onFilesPicked = useCallback(
    async (list: FileList | null) => {
      if (!list || !list.length) return;
      const files = Array.from(list);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // Sequential: each upload runs ingest+synth on core, which shouldn't overlap.
      for (const file of files) {
        await runUpload(file);
      }
    },
    [runUpload],
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((u) => u.filter((x) => x.id !== id));
  }, []);

  function onResizeDown(side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragRef.current = { side, startX: event.clientX, startW: side === "left" ? libW : qaW };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(side);
  }
  function onResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    if (d.side === "left") setLibW(clamp(d.startW + dx, LIB_MIN, LIB_MAX));
    else setQaW(clamp(d.startW - dx, QA_MIN, QA_MAX));
  }
  function onResizeUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  }
  function onResizeKey(side: "left" | "right", event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const grow = side === "left" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
    const delta = grow ? STEP : -STEP;
    if (side === "left") setLibW((w) => clamp(w + delta, LIB_MIN, LIB_MAX));
    else setQaW((w) => clamp(w + delta, QA_MIN, QA_MAX));
  }

  const cols: string[] = [];
  if (!leftCollapsed) cols.push(`${libW}px`, "6px");
  cols.push("minmax(0,1fr)");
  if (!rightCollapsed) cols.push("6px", `${qaW}px`);

  return (
    <section
      className="mb-research"
      data-mobile={isNarrow ? mobilePanel : undefined}
      style={{ gridTemplateColumns: cols.join(" ") }}
    >
      {isNarrow ? (
        <div className="mb-mobile-tabs" role="group" aria-label="切换面板">
          <button
            type="button"
            aria-pressed={mobilePanel === "lib"}
            className={mobilePanel === "lib" ? "on" : ""}
            onClick={() => setMobilePanel("lib")}
          >
            论文库
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === "reader"}
            className={mobilePanel === "reader" ? "on" : ""}
            onClick={() => setMobilePanel("reader")}
          >
            阅读
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === "qa"}
            className={mobilePanel === "qa" ? "on" : ""}
            onClick={() => setMobilePanel("qa")}
          >
            知识问答
          </button>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => void onFilesPicked(e.target.files)}
      />

      {/* Always mounted; hidden (not unmounted) when collapsed so panel state —
          the library list, and the chat history in QaPanel — survives a collapse
          + expand. (Unmounting on collapse would wipe that local state.) */}
      <PaperLibrary
        client={client}
        selectedPath={paper?.path ?? null}
        onSelect={selectPaper}
        onPickClick={triggerPick}
        uploads={uploads}
        onDismissUpload={dismissUpload}
        onRetryUpload={retryUpload}
        reloadKey={libReloadKey}
        hidden={isNarrow ? false : leftCollapsed}
      />
      {!leftCollapsed ? (
        <div
          className="mb-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整论文库宽度"
          aria-valuenow={libW}
          aria-valuemin={LIB_MIN}
          aria-valuemax={LIB_MAX}
          data-dragging={dragging === "left" ? "true" : "false"}
          tabIndex={0}
          onPointerDown={(e) => onResizeDown("left", e)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={(e) => onResizeKey("left", e)}
        />
      ) : null}

      <PaperReader
        paper={paper}
        client={client}
        assetBaseUrl={assetBaseUrl}
        assetToken={assetToken}
        translatorEnabled={translatorEnabled}
        translateCache={translateCache}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={() => setLeftCollapsed((v) => !v)}
        onToggleRight={() => setRightCollapsed((v) => !v)}
        onUpload={triggerPick}
      />

      {!rightCollapsed ? (
        <div
          className="mb-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整知识问答宽度"
          aria-valuenow={qaW}
          aria-valuemin={QA_MIN}
          aria-valuemax={QA_MAX}
          data-dragging={dragging === "right" ? "true" : "false"}
          tabIndex={0}
          onPointerDown={(e) => onResizeDown("right", e)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={(e) => onResizeKey("right", e)}
        />
      ) : null}
      <QaPanel
        paper={paper}
        agentClient={agentClient}
        hidden={isNarrow ? false : rightCollapsed}
        onSaveAnswer={onSaveAnswer}
      />

      {leftCollapsed ? (
        <button
          type="button"
          className="mb-edge mb-edge-left"
          title="展开论文库"
          aria-label="展开论文库"
          onClick={() => setLeftCollapsed(false)}
        >
          <PanelLeftOpen size={18} aria-hidden="true" />
        </button>
      ) : null}
      {rightCollapsed ? (
        <button
          type="button"
          className="mb-edge mb-edge-right"
          title="展开知识问答"
          aria-label="展开知识问答"
          onClick={() => setRightCollapsed(false)}
        >
          <PanelRightOpen size={18} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

export type { UploadStage };
