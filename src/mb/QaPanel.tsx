import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bookmark, FileText, Loader2, MessageSquareText } from "lucide-react";
import type { AgentClient } from "../api/agentClient";
import { MarkdownView } from "../components/MarkdownView";
import { basename } from "../utils/format";
import type { AgentSource } from "../agent/types";
import type { CurrentPaper } from "./MbApp";

interface Props {
  paper: CurrentPaper | null;
  agentClient: AgentClient;
  /** Hidden (display:none) when the panel is collapsed — kept mounted so the
   *  chat history isn't lost on collapse/expand. */
  hidden?: boolean;
  /** Save a whole answer to 我的笔记 (mirrored to the Wisdom layer). */
  onSaveAnswer?: (text: string) => void;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: AgentSource[];
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function Cites({ sources }: { sources: AgentSource[] }) {
  const seen = new Set<string>();
  const list: AgentSource[] = [];
  for (const s of sources) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    list.push(s);
  }
  if (!list.length) return null;
  return (
    <div className="mb-cite">
      {list.slice(0, 6).map((s, i) => (
        <span key={`${s.path}-${i}`} title={s.path}>
          <FileText size={12} aria-hidden="true" />
          来源 · {s.title || basename(s.path)}
        </span>
      ))}
    </div>
  );
}

const EMPTY: Msg[] = [];

export function QaPanel({ paper, agentClient, hidden, onSaveAnswer }: Props) {
  // Chat history + agent session are kept per paper (keyed by path) so switching
  // papers and coming back restores that paper's Q&A instead of wiping it. The
  // panel stays mounted (see ResearchWorkspace), so this in-memory store survives
  // collapse / view switches / saving an answer to notes — only a full reload
  // clears it. Each paper still gets its own agent session so retrieval stays
  // scoped.
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const sessionsRef = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [streamAns, setStreamAns] = useState("");
  const [streamSrc, setStreamSrc] = useState<AgentSource[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);
  const msgsRef = useRef<HTMLDivElement | null>(null);

  const path = paper?.path ?? null;
  const messages = path ? (chats[path] ?? EMPTY) : EMPTY;

  // On paper change: abort any in-flight request and clear the transient stream /
  // draft. Committed messages are NOT cleared — they live per-paper in `chats`
  // above, so returning to a paper shows its conversation again.
  useEffect(() => {
    ctrlRef.current?.abort();
    setStreamAns("");
    setStreamSrc([]);
    setRunning(false);
    setDraft("");
  }, [path]);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamAns, running]);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  async function send() {
    const q = draft.trim();
    if (!q || running || !paper) return;
    // Capture the paper this question belongs to; every write below keys off it,
    // so a mid-flight paper switch can't misfile the answer.
    const key = paper.path;
    const title = paper.title;
    setDraft("");
    setChats((c) => ({ ...c, [key]: [...(c[key] ?? EMPTY), { role: "user", content: q }] }));
    setRunning(true);
    setStreamAns("");
    setStreamSrc([]);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      let sid = sessionsRef.current[key];
      if (!sid) {
        const s = await agentClient.createSession();
        sid = s.id;
        sessionsRef.current[key] = sid;
      }
      const prompt = `关于论文《${title}》：${q}`;
      let ans = "";
      const srcs: AgentSource[] = [];
      for await (const ev of agentClient.sendMessage(sid, prompt, ctrl.signal)) {
        if (ev.type === "message_delta") {
          ans += ev.delta;
          setStreamAns(ans);
        } else if (ev.type === "source") {
          srcs.push(ev.source);
          setStreamSrc([...srcs]);
        } else if (ev.type === "error") {
          ans = ans || `出错了：${ev.message}`;
        }
      }
      setChats((c) => ({
        ...c,
        [key]: [
          ...(c[key] ?? EMPTY),
          { role: "assistant", content: ans || "（没有返回内容）", sources: srcs },
        ],
      }));
    } catch {
      if (!ctrl.signal.aborted) {
        setChats((c) => ({
          ...c,
          [key]: [...(c[key] ?? EMPTY), { role: "assistant", content: "请求失败，请稍后重试。" }],
        }));
      }
    } finally {
      // Only the still-current request clears the shared stream / running flags —
      // a request aborted by a paper switch must not stomp the new paper's state.
      if (ctrlRef.current === ctrl) {
        setStreamAns("");
        setStreamSrc([]);
        setRunning(false);
      }
    }
  }

  return (
    <aside className={`mb-col mb-qa${hidden ? " mb-col--hidden" : ""}`}>
      <div className="mb-qa-h">
        <b>
          <MessageSquareText size={17} aria-hidden="true" />
          知识问答
        </b>
        <span>{paper ? `针对《${trunc(paper.title, 20)}》` : "先选择一篇论文"}</span>
      </div>
      <div className="mb-msgs" ref={msgsRef}>
        {!paper ? (
          <div className="mb-m-hint">先在左侧选择一篇论文</div>
        ) : !messages.length && !running ? (
          <div className="mb-m-hint">问点什么？例如“这篇论文的核心创新是什么？”</div>
        ) : (
          <>
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="mb-m-u">
                  {m.content}
                </div>
              ) : (
                <div key={i} className="mb-m-a">
                  <MarkdownView body={m.content} showFrontmatter={false} />
                  {m.sources?.length ? <Cites sources={m.sources} /> : null}
                  {onSaveAnswer ? (
                    <div className="mb-m-actions">
                      <button
                        type="button"
                        className="mb-save-ans"
                        onClick={() => onSaveAnswer(m.content)}
                      >
                        <Bookmark size={13} aria-hidden="true" />
                        全部存入笔记
                      </button>
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {running ? (
              <div className="mb-m-a">
                {streamAns ? (
                  <MarkdownView body={streamAns} showFrontmatter={false} />
                ) : (
                  <span
                    style={{ color: "var(--faint)", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Loader2 className="mb-spin" size={14} aria-hidden="true" />
                    正在检索这篇论文…
                  </span>
                )}
                {streamSrc.length ? <Cites sources={streamSrc} /> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="mb-qa-in">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Don't submit mid-IME — confirming a Pinyin candidate with Enter
            // would otherwise send a half-typed question.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
          placeholder={paper ? "问这篇论文…" : "先选择论文"}
          disabled={!paper || running}
          aria-label="提问"
        />
        <button
          className="mb-snd"
          type="button"
          onClick={() => void send()}
          disabled={!paper || running || !draft.trim()}
          aria-label="发送"
        >
          <ArrowUp size={19} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
