import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookText,
  Bookmark,
  Check,
  Contrast,
  File,
  Files,
  MessageSquareText,
  Settings,
} from "lucide-react";
import { DikwClient, normalizeBaseUrl } from "../api/client";
import { AgentClient } from "../api/agentClient";
import {
  fetchTranslateEnabled,
  tryOpenDefaultTranslateCache,
  type TranslateCache,
} from "../utils/translate";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { NotesView } from "./NotesView";
import { defaultServerUrl, loadConnection, type MbConnection } from "./connection";
import { useSharedTheme } from "./theme";
import { archiveNoteInWisdom, writeNoteToWisdom } from "./wisdom-sync";
import "./mb.css";

export type NoteKind = "clip" | "answer" | "thought";

export type NoteSync = "syncing" | "synced" | "error";

export interface MbNote {
  nid: string;
  type: NoteKind;
  quote: string;
  txt: string;
  src: string;
  srcType: "" | "paper" | "chat";
  /** D-layer source path the clip/answer came from, for the Wisdom `sources` link. */
  srcPath?: string;
  tags: string[];
  ts: number;
  isNew?: boolean;
  /** Wisdom-layer mirror status (localStorage stays the source of truth). */
  sync?: NoteSync;
  wisdomPath?: string;
}

export interface CurrentPaper {
  path: string;
  title: string;
}

type MbView = "research" | "notes";

const notesKey = "dikw-mb.notes";

function newNid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function loadNotes(): MbNote[] {
  try {
    const raw = localStorage.getItem(notesKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is MbNote => !!n && typeof (n as MbNote).nid === "string")
      .map((n) => ({
        // Coerce the render-critical fields so a corrupt / schema-drifted entry
        // can't crash the notes view (KIND[type], tags.map, formatNoteDate).
        ...n,
        type: n.type === "clip" || n.type === "answer" || n.type === "thought" ? n.type : "thought",
        tags: Array.isArray(n.tags) ? n.tags : [],
        ts: typeof n.ts === "number" ? n.ts : Date.now(),
      }));
  } catch {
    return [];
  }
}

interface HighlightRegistryLike {
  set(name: string, value: object): void;
  delete(name: string): void;
}

// Persist a "staged" highlight over the selected text via the CSS Custom
// Highlight API, so the chosen passage stays visibly marked while the user moves
// to the save chip / popover (by then the native selection is cleared). No-op
// where the API is unavailable (older browsers keep the native selection only).
function stageHighlight(range: Range | null): void {
  const reg = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  const HighlightCtor = (globalThis as { Highlight?: new (range: Range) => object }).Highlight;
  if (!reg || typeof HighlightCtor !== "function") return;
  if (!range) {
    reg.delete("mb-staged");
    return;
  }
  try {
    reg.set("mb-staged", new HighlightCtor(range.cloneRange()));
  } catch {
    reg.delete("mb-staged");
  }
}

export function MbApp() {
  // MB-Web is read-only over the connection: it loads what the workbench
  // Settings page saved to localStorage. The gear navigates to #settings to
  // edit it (see the header button below).
  const [conn] = useState<MbConnection>(() => loadConnection());
  const { serverUrl, token } = conn;
  // Theme is shared with the workbench (read from `dikw-web.theme`); MB-Web keeps
  // a one-tap toggle but no longer owns its own storage. See ./theme. MbApp only
  // needs the toggle — the hook applies the theme to <html> itself.
  const [, toggleTheme] = useSharedTheme();
  const [view, setView] = useState<MbView>("research");
  const [coreState, setCoreState] = useState<"checking" | "ok" | "down">("checking");
  const [notes, setNotes] = useState<MbNote[]>(() => loadNotes());

  const [translatorEnabled, setTranslatorEnabled] = useState(false);
  const [translateCache, setTranslateCache] = useState<TranslateCache | null>(null);

  const currentPaperRef = useRef<CurrentPaper | null>(null);

  const clientBaseUrl = normalizeBaseUrl(serverUrl) === defaultServerUrl ? "" : serverUrl;
  const client = useMemo(
    () => new DikwClient({ baseUrl: clientBaseUrl, token, coreId: serverUrl }),
    [clientBaseUrl, token, serverUrl],
  );
  const agentClient = useMemo(
    () => new AgentClient({ coreUrl: serverUrl, token }),
    [serverUrl, token],
  );

  // persist notes
  useEffect(() => {
    localStorage.setItem(notesKey, JSON.stringify(notes));
  }, [notes]);

  // probe sidecar translator once (gates 中英对照)
  useEffect(() => {
    let cancelled = false;
    void fetchTranslateEnabled().then((enabled) => {
      if (cancelled) return;
      setTranslatorEnabled(enabled);
      if (enabled) {
        void tryOpenDefaultTranslateCache().then((cache) => {
          if (!cancelled) setTranslateCache(cache);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // health dot — tri-state so a failed probe settles on "未连接" instead of
  // looking stuck at "连接中…" (issue #97).
  useEffect(() => {
    let cancelled = false;
    setCoreState("checking");
    void client
      .get("/v1/health")
      .then(() => {
        if (!cancelled) setCoreState("ok");
      })
      .catch(() => {
        if (!cancelled) setCoreState("down");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const addNote = useCallback((partial: Omit<MbNote, "nid" | "ts">): MbNote => {
    const note: MbNote = { ...partial, nid: newNid(), ts: Date.now() };
    setNotes((prev) => [note, ...prev]);
    return note;
  }, []);

  // Mirror a note into the Wisdom layer (embedded → agent-retrievable). The
  // local note stays the source of truth; this just tracks the write status so
  // the card can show 同步中 / 已入 Wisdom / 重试.
  const syncNote = useCallback(
    async (note: MbNote) => {
      setNotes((prev) => prev.map((n) => (n.nid === note.nid ? { ...n, sync: "syncing" } : n)));
      try {
        const path = await writeNoteToWisdom(client, note);
        setNotes((prev) =>
          prev.map((n) => (n.nid === note.nid ? { ...n, sync: "synced", wisdomPath: path } : n)),
        );
      } catch {
        setNotes((prev) => prev.map((n) => (n.nid === note.nid ? { ...n, sync: "error" } : n)));
      }
    },
    [client],
  );

  // Best-effort archive on delete — only if the note actually reached Wisdom.
  const archiveNote = useCallback(
    (note: MbNote) => {
      if (note.sync !== "synced") return;
      void archiveNoteInWisdom(client, note).catch(() => {});
    },
    [client],
  );

  // ── selection → "存到我的笔记" chip + popover ───────────────────────────
  const [chip, setChip] = useState<{ show: boolean; x: number; y: number }>({
    show: false,
    x: 0,
    y: 0,
  });
  const [pop, setPop] = useState<{
    show: boolean;
    x: number;
    y: number;
    quote: string;
    type: NoteKind;
    src: string;
    srcType: "paper" | "chat";
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const selTextRef = useRef("");
  const selRectRef = useRef<DOMRect | null>(null);
  const selSrcRef = useRef("");
  const selSrcPathRef = useRef<string | undefined>(undefined);
  const selTypeRef = useRef<NoteKind>("clip");
  const popOpenRef = useRef(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popTextRef = useRef<HTMLTextAreaElement | null>(null);

  popOpenRef.current = !!pop?.show;

  const toastTimerRef = useRef<number | undefined>(undefined);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  // Save a whole Q&A answer to 我的笔记 (kind "answer") + mirror to Wisdom.
  const saveAnswerNote = useCallback(
    (text: string) => {
      const quote = text.trim();
      if (!quote) return;
      const paper = currentPaperRef.current;
      const note = addNote({
        type: "answer",
        quote,
        txt: "",
        src: paper ? `对话 · ${paper.title}` : "对话",
        srcType: "chat",
        srcPath: paper?.path,
        tags: ["问答摘录"],
      });
      showToast("已存入我的笔记");
      void syncNote(note);
    },
    [addNote, syncNote, showToast],
  );

  useEffect(() => {
    function onUp() {
      window.setTimeout(() => {
        const sel = window.getSelection();
        const txt = sel ? sel.toString().trim() : "";
        if (!txt || txt.length < 2) {
          if (!popOpenRef.current) setChip((c) => ({ ...c, show: false }));
          return;
        }
        const node = sel?.anchorNode ?? null;
        const host = node
          ? node.nodeType === 3
            ? node.parentElement
            : (node as HTMLElement)
          : null;
        if (!host) return;
        const inReader = host.closest(".mb-reader");
        const inChat = host.closest(".mb-msgs");
        if (!inReader && !inChat) {
          setChip((c) => ({ ...c, show: false }));
          return;
        }
        const paper = currentPaperRef.current;
        selTextRef.current = txt;
        selTypeRef.current = inChat ? "answer" : "clip";
        selSrcRef.current = inChat ? `对话 · ${paper?.title ?? ""}` : (paper?.title ?? "");
        selSrcPathRef.current = paper?.path;
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        selRectRef.current = rect;
        // Mark the chosen text so it stays visible through the save flow.
        stageHighlight(range);
        const x = Math.max(10, Math.min(rect.left + rect.width / 2 - 70, window.innerWidth - 150));
        const y = Math.max(10, rect.top - 44);
        setChip({ show: true, x, y });
      }, 10);
    }
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Drop the staged highlight once neither the chip nor the popover is showing
  // (i.e. the user saved, cancelled, or clicked away).
  useEffect(() => {
    if (!chip.show && !pop?.show) stageHighlight(null);
  }, [chip.show, pop?.show]);

  // toasts raised by descendants (e.g. the upload button) ride a window event
  // so we don't have to prop-drill showToast through the workspace tree.
  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") showToast(detail);
    }
    window.addEventListener("mb-toast", onToast as EventListener);
    return () => window.removeEventListener("mb-toast", onToast as EventListener);
  }, [showToast]);

  // close popover on outside click / Escape
  useEffect(() => {
    if (!pop?.show) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (chipRef.current?.contains(t)) return;
      setPop(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPop(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pop?.show]);

  function openPopFromChip() {
    setChip((c) => ({ ...c, show: false }));
    const rect = selRectRef.current;
    const full = selTextRef.current;
    const quote = full.length > 140 ? `${full.slice(0, 140)}…` : full;
    const w = 300;
    const left = rect ? Math.max(10, Math.min(rect.left, window.innerWidth - w - 10)) : 40;
    let top = rect ? rect.bottom + 10 : 80;
    if (top + 250 > window.innerHeight) top = rect ? Math.max(10, rect.top - 262) : 80;
    setPop({
      show: true,
      x: left,
      y: top,
      quote,
      type: selTypeRef.current,
      src: selSrcRef.current,
      srcType: selTypeRef.current === "answer" ? "chat" : "paper",
    });
    window.setTimeout(() => popTextRef.current?.focus(), 0);
  }

  function savePop() {
    if (!pop) return;
    const thought = popTextRef.current?.value.trim() ?? "";
    const note = addNote({
      type: pop.type,
      quote: selTextRef.current,
      txt: thought,
      src: pop.src,
      srcType: pop.srcType,
      srcPath: selSrcPathRef.current,
      tags: pop.type === "answer" ? ["问答摘录"] : ["摘录"],
    });
    setPop(null);
    window.getSelection()?.removeAllRanges();
    showToast("已存入我的笔记");
    void syncNote(note);
  }

  // While a selection is awaiting a save/dismiss decision (chip or popover up),
  // suppress the bilingual paragraph hover highlight (.mb-selecting in mb.css) so
  // the chosen text's yellow selection stays clearly visible instead of being
  // covered by the green hover block. Restored once the user decides.
  const selectionPending = chip.show || !!pop?.show;

  return (
    <div className={`mb-app${selectionPending ? " mb-selecting" : ""}`}>
      <header className="mb-top">
        <div className="mb-lgroup">
          <div className="mb-brand">
            <BookText size={20} aria-hidden="true" />
            论文知识库
          </div>
          <div className="mb-seg" role="group" aria-label="视图">
            <button
              type="button"
              aria-pressed={view === "research"}
              className={view === "research" ? "on" : ""}
              onClick={() => setView("research")}
            >
              <Files size={15} aria-hidden="true" />
              论文研究
            </button>
            <button
              type="button"
              aria-pressed={view === "notes"}
              className={view === "notes" ? "on" : ""}
              onClick={() => setView("notes")}
            >
              <Bookmark size={15} aria-hidden="true" />
              我的笔记
              {notes.length ? <span className="mb-badge">{notes.length}</span> : null}
            </button>
          </div>
        </div>
        <div className="mb-rgroup">
          <span>
            <span className={`mb-dot ${coreState === "down" ? "off" : ""}`} />
            {coreState === "ok"
              ? "已连接 · dikw-core"
              : coreState === "checking"
                ? "连接中…"
                : "未连接 · dikw-core"}
          </span>
          <button
            className="mb-iconbtn"
            type="button"
            aria-label="连接设置"
            title="连接设置"
            onClick={() => {
              window.location.hash = "#settings";
            }}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
          <button
            className="mb-iconbtn"
            type="button"
            aria-label="切换主题"
            title="切换深/浅色"
            onClick={toggleTheme}
          >
            <Contrast size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="mb-main">
        <section
          style={{
            display: view === "research" ? "flex" : "none",
            flex: 1,
            minHeight: 0,
          }}
        >
          <ResearchWorkspace
            client={client}
            agentClient={agentClient}
            assetBaseUrl={clientBaseUrl}
            assetToken={token}
            translatorEnabled={translatorEnabled}
            translateCache={translateCache}
            onCurrentPaperChange={(p) => {
              currentPaperRef.current = p;
            }}
            onSaveAnswer={saveAnswerNote}
          />
        </section>
        <section
          style={{
            display: view === "notes" ? "flex" : "none",
            flex: 1,
            minHeight: 0,
          }}
        >
          <NotesView
            notes={notes}
            setNotes={setNotes}
            onSyncNote={syncNote}
            onArchiveNote={archiveNote}
          />
        </section>
      </main>

      {chip.show ? (
        <button
          ref={chipRef}
          className="mb-chip"
          style={{ left: chip.x, top: chip.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openPopFromChip}
        >
          <Bookmark size={15} aria-hidden="true" />
          存到我的笔记
        </button>
      ) : null}

      {pop?.show ? (
        <div ref={popRef} className="mb-pop" style={{ left: pop.x, top: pop.y }}>
          <div className="mb-pop-h">
            <Bookmark size={16} aria-hidden="true" />
            存入我的笔记
          </div>
          <div className="mb-pop-q">“{pop.quote}”</div>
          <textarea ref={popTextRef} placeholder="补充我的想法（可选）…" />
          <div className="mb-pop-meta">
            <span className="src">
              {pop.srcType === "chat" ? (
                <MessageSquareText size={13} aria-hidden="true" />
              ) : (
                <File size={13} aria-hidden="true" />
              )}
              <span>来源 · {pop.src || "—"}</span>
            </span>
            <span className="mb-pop-w">→ Wisdom 层</span>
          </div>
          <div className="mb-pop-act">
            <button type="button" className="mb-btn" onClick={() => setPop(null)}>
              取消
            </button>
            <button type="button" className="mb-btn pri" onClick={savePop}>
              存入笔记
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="mb-toast" role="status" aria-live="polite">
          <Check size={16} aria-hidden="true" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
