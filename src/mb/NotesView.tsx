import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bookmark,
  Check,
  ChevronLeft,
  FileText,
  File as FileIcon,
  Lightbulb,
  Loader2,
  MessageSquareText,
  PencilLine,
  Plus,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";
import { MarkdownView } from "../components/MarkdownView";
import type { MbNote, NoteKind, NoteSync } from "./MbApp";

interface Props {
  notes: MbNote[];
  setNotes: Dispatch<SetStateAction<MbNote[]>>;
  onSyncNote?: (note: MbNote) => void;
  onArchiveNote?: (note: MbNote) => void;
}

const SYNC_LABEL: Record<NoteSync, string> = {
  syncing: "同步中",
  synced: "已入 Wisdom",
  error: "同步失败 · 重试",
};

function SyncChip({ note, onRetry }: { note: MbNote; onRetry: () => void }) {
  if (!note.sync) return null;
  return (
    <button
      type="button"
      className={`mb-sync mb-sync--${note.sync}`}
      disabled={note.sync !== "error"}
      title={note.sync === "synced" && note.wisdomPath ? note.wisdomPath : SYNC_LABEL[note.sync]}
      onClick={(e) => {
        e.stopPropagation();
        if (note.sync === "error") onRetry();
      }}
    >
      {note.sync === "syncing" ? (
        <Loader2 className="mb-spin" size={11} aria-hidden="true" />
      ) : note.sync === "synced" ? (
        <Check size={11} aria-hidden="true" />
      ) : (
        <RotateCw size={11} aria-hidden="true" />
      )}
      {SYNC_LABEL[note.sync]}
    </button>
  );
}

type FilterKey = "all" | NoteKind;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "clip", label: "论文摘录" },
  { key: "answer", label: "问答摘录" },
  { key: "thought", label: "我的想法" },
];

const KIND: Record<NoteKind, { label: string; cls: string }> = {
  clip: { label: "论文摘录", cls: "clip" },
  answer: { label: "问答摘录", cls: "answer" },
  thought: { label: "我的想法", cls: "thought" },
};

function KindIcon({ kind }: { kind: NoteKind }) {
  if (kind === "answer") return <MessageSquareText size={13} aria-hidden="true" />;
  if (kind === "thought") return <Lightbulb size={13} aria-hidden="true" />;
  return <FileText size={13} aria-hidden="true" />;
}

function newNid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function formatNoteDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) {
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** A short plain-text preview for the card (strip Markdown so the snippet is
 *  clean even when the saved content is a formatted 问答摘录). */
function notePreview(note: MbNote): string {
  const base = note.quote || note.txt || "";
  const text = base
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~]/g, " ")
    .replace(/\$\$?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function NotesView({ notes, setNotes, onSyncNote, onArchiveNote }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [kw, setKw] = useState("");
  // The opened note (detail page). null = the card list.
  const [detailNid, setDetailNid] = useState<string | null>(null);
  // The note being edited (only ever the one on the detail page).
  const [editNid, setEditNid] = useState<string | null>(null);
  // A note pending delete confirmation (null = no dialog showing).
  const [confirmNote, setConfirmNote] = useState<MbNote | null>(null);
  const quoteRef = useRef<HTMLTextAreaElement | null>(null);
  const txtRef = useRef<HTMLTextAreaElement | null>(null);

  const detail = detailNid ? (notes.find((n) => n.nid === detailNid) ?? null) : null;

  function createNote() {
    const o: MbNote = {
      nid: newNid(),
      type: "thought",
      quote: "",
      txt: "",
      src: "",
      srcType: "",
      tags: [],
      ts: Date.now(),
      isNew: true,
    };
    setFilter("all");
    setKw("");
    setNotes((prev) => [o, ...prev]);
    setDetailNid(o.nid);
    setEditNid(o.nid);
  }

  function openDetail(nid: string) {
    setDetailNid(nid);
    setEditNid(null);
  }

  function backToList() {
    // Discard an unsaved brand-new note when leaving its detail page.
    if (detail?.isNew) {
      setNotes((prev) => prev.filter((n) => n.nid !== detail.nid));
    }
    setDetailNid(null);
    setEditNid(null);
  }

  function removeNote(note: MbNote) {
    onArchiveNote?.(note);
    setNotes((prev) => prev.filter((n) => n.nid !== note.nid));
    if (editNid === note.nid) setEditNid(null);
    if (detailNid === note.nid) setDetailNid(null);
  }

  // Deletes ask first — stash the pending note; only remove it on confirm.
  function requestDelete(note: MbNote) {
    setConfirmNote(note);
  }
  function confirmDelete() {
    if (confirmNote) {
      // Re-resolve from the live list: the note's Wisdom-sync status may have
      // advanced to "synced" while the dialog was open, and removeNote needs the
      // current value to archive the mirror instead of leaving it orphaned.
      const fresh = notes.find((n) => n.nid === confirmNote.nid) ?? confirmNote;
      removeNote(fresh);
    }
    setConfirmNote(null);
  }

  function cancelEdit(note: MbNote) {
    if (note.isNew) {
      setNotes((prev) => prev.filter((n) => n.nid !== note.nid));
      setDetailNid(null);
    }
    setEditNid(null);
  }

  function saveEdit(note: MbNote) {
    const quote = quoteRef.current?.value.trim() ?? "";
    const txt = txtRef.current?.value.trim() ?? "";
    if (note.isNew && !quote && !txt) {
      setNotes((prev) => prev.filter((n) => n.nid !== note.nid));
      setDetailNid(null);
      setEditNid(null);
      return;
    }
    const updated: MbNote = { ...note, quote, txt, isNew: undefined };
    setNotes((prev) => prev.map((n) => (n.nid === note.nid ? updated : n)));
    setEditNid(null);
    onSyncNote?.(updated);
  }

  const confirmModal = confirmNote ? (
    <div className="mb-confirm-backdrop" role="presentation" onClick={() => setConfirmNote(null)}>
      <div
        className="mb-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除笔记"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-confirm-h">
          <Trash2 size={16} aria-hidden="true" />
          删除这条笔记？
        </div>
        <div className="mb-confirm-b">
          删除后无法恢复
          {confirmNote.sync === "synced" ? "，已同步到 Wisdom 层的镜像也会一并归档" : ""}。
        </div>
        <div className="mb-pop-act">
          <button type="button" className="mb-btn" onClick={() => setConfirmNote(null)}>
            取消
          </button>
          <button type="button" className="mb-btn danger" onClick={confirmDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── detail page ──────────────────────────────────────────────────────────
  if (detail) {
    const editing = editNid === detail.nid;
    return (
      <div className="mb-notes">
        {confirmModal}
        <div className="mb-notes-in mb-notes-in--detail">
          <div className="mb-detail-bar">
            <button className="mb-back" type="button" onClick={backToList}>
              <ChevronLeft size={16} aria-hidden="true" />
              返回我的笔记
            </button>
            {!editing ? (
              <span className="right">
                <button
                  className="mb-na"
                  type="button"
                  aria-label="编辑"
                  onClick={() => setEditNid(detail.nid)}
                >
                  <PencilLine size={16} aria-hidden="true" />
                </button>
                <button
                  className="mb-na"
                  type="button"
                  aria-label="删除"
                  onClick={() => requestDelete(detail)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </span>
            ) : null}
          </div>

          <div className="mb-note mb-note--detail">
            <div className="mb-note-top">
              <span className={`mb-kind ${KIND[detail.type].cls}`}>
                <KindIcon kind={detail.type} />
                {KIND[detail.type].label}
              </span>
              <span className="right">
                <span className="mb-note-date">{formatNoteDate(detail.ts)}</span>
                <SyncChip note={detail} onRetry={() => onSyncNote?.(detail)} />
              </span>
            </div>

            {editing ? (
              <>
                <div className="mb-ed-lab">引文（可留空）</div>
                <textarea
                  ref={quoteRef}
                  className="mb-ed-quote"
                  defaultValue={detail.quote}
                  placeholder="引用的原文…"
                />
                <div className="mb-ed-lab">我的批注 / 想法</div>
                <textarea
                  ref={txtRef}
                  className="mb-ed-txt"
                  defaultValue={detail.txt}
                  placeholder="写下我的想法…"
                />
                <div className="mb-pop-act">
                  <button type="button" className="mb-btn" onClick={() => cancelEdit(detail)}>
                    取消
                  </button>
                  <button type="button" className="mb-btn pri" onClick={() => saveEdit(detail)}>
                    保存
                  </button>
                </div>
              </>
            ) : (
              <>
                {detail.quote ? (
                  <div className="mb-quote">
                    {/* Render the saved content as Markdown so a 问答摘录 reads the
                        same as in 知识问答 (bold / lists / code / math). */}
                    <MarkdownView body={detail.quote} showFrontmatter={false} />
                  </div>
                ) : null}
                {detail.txt ? (
                  // The user's own annotation is shown distinctly from the quoted
                  // source above it — a labelled, accent block so "my note" reads
                  // apart from "the original / answer".
                  <div className="mb-anno">
                    <div className="mb-anno-lab">
                      <PencilLine size={12} aria-hidden="true" />
                      我的批注 / 想法
                    </div>
                    <p className="mb-anno-body">{detail.txt}</p>
                  </div>
                ) : null}
                <div className="mb-note-foot">
                  {detail.src ? (
                    <span className="src">
                      {detail.srcType === "chat" ? (
                        <MessageSquareText size={13} aria-hidden="true" />
                      ) : (
                        <FileIcon size={13} aria-hidden="true" />
                      )}
                      {detail.src}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── card list ────────────────────────────────────────────────────────────
  const needle = kw.trim().toLowerCase();
  const visible = notes.filter((o) => {
    if (filter !== "all" && o.type !== filter) return false;
    if (!needle) return true;
    const hay = `${o.quote} ${o.txt} ${o.src}`.toLowerCase();
    return hay.includes(needle);
  });

  return (
    <div className="mb-notes">
      {confirmModal}
      <div className="mb-notes-in">
        <div className="mb-notes-head">
          <div className="t">
            <Bookmark size={22} aria-hidden="true" />
            我的笔记{" "}
            <span style={{ fontSize: 13, color: "var(--faint)", fontWeight: 400 }}>
              · {notes.length}
            </span>
          </div>
          <div className="mb-head-tools">
            <div className="mb-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="搜索笔记…"
                aria-label="搜索笔记"
              />
            </div>
            <button className="mb-btn pri" type="button" onClick={createNote}>
              <Plus size={16} aria-hidden="true" />
              新建笔记
            </button>
          </div>
        </div>

        <div className="mb-filters" role="tablist" aria-label="筛选">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`mb-f${filter === f.key ? " on" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visible.length ? (
          <div className="mb-note-grid">
            {visible.map((o) => (
              <div
                key={o.nid}
                className="mb-note-card"
                role="button"
                tabIndex={0}
                onClick={() => openDetail(o.nid)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetail(o.nid);
                  }
                }}
              >
                <div className="mb-note-top">
                  <span className={`mb-kind ${KIND[o.type].cls}`}>
                    <KindIcon kind={o.type} />
                    {KIND[o.type].label}
                  </span>
                  <span className="right">
                    <span className="mb-note-date">{formatNoteDate(o.ts)}</span>
                    <button
                      className="mb-na"
                      type="button"
                      aria-label="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(o);
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </span>
                </div>
                <div className="mb-card-preview">{notePreview(o) || "（空笔记）"}</div>
                <div className="mb-note-foot">
                  {o.src ? (
                    <span className="src">
                      {o.srcType === "chat" ? (
                        <MessageSquareText size={13} aria-hidden="true" />
                      ) : (
                        <FileIcon size={13} aria-hidden="true" />
                      )}
                      {o.src}
                    </span>
                  ) : null}
                  <SyncChip note={o} onRetry={() => onSyncNote?.(o)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-empty">
            还没有笔记。在论文或对话里选中文字即可收藏，或点「新建笔记」。
          </div>
        )}
      </div>
    </div>
  );
}
