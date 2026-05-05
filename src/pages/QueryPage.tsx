import { useRef, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import type { Citation, Hit, QueryResult } from "../types";
import { formatScore } from "../utils/format";

interface QueryPageProps {
  client: DikwClient;
}

export function QueryPage({ client }: QueryPageProps) {
  const [question, setQuestion] = useState("");
  const [limit, setLimit] = useState(5);
  const [answer, setAnswer] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [appliedWisdom, setAppliedWisdom] = useState<QueryResult["applied_wisdom"]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function runQuery() {
    const q = question.trim();
    if (!q || running) {
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setAnswer("");
    setHits([]);
    setCitations([]);
    setAppliedWisdom([]);
    setError(null);
    setFinalStatus(null);
    setRunning(true);

    try {
      for await (const event of client.streamQuery({ q, limit }, controller.signal)) {
        if (event.type === "retrieval_done") {
          setHits(event.hits);
        } else if (event.type === "llm_token") {
          setAnswer((value) => value + event.delta);
        } else if (event.type === "final") {
          setFinalStatus(event.status);
          if (event.status === "succeeded") {
            setAnswer((value) => value || event.result.answer);
            setCitations(event.result.citations);
            setAppliedWisdom(event.result.applied_wisdom);
          } else {
            setError(event.error ? new Error(event.error.message) : new Error(`query ${event.status}`));
          }
        }
      }
    } catch (nextError) {
      if (!controller.signal.aborted) {
        setError(nextError);
      }
    } finally {
      if (!controller.signal.aborted) {
        setRunning(false);
      } else {
        setRunning(false);
        setFinalStatus("cancelled");
      }
    }
  }

  function stopQuery() {
    controllerRef.current?.abort();
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Query</p>
          <h1>自然语言查阅</h1>
        </div>
      </header>

      <section className="query-shell">
        <div className="query-main">
          <div className="query-form">
            <label className="field field--grow">
              <span>Question</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="输入要向当前 wiki 提出的问题"
                rows={3}
              />
            </label>
            <label className="field field--small">
              <span>Limit</span>
              <input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              />
            </label>
            <button className="primary-button" type="button" onClick={runQuery} disabled={running || !question.trim()}>
              <Play size={16} />
              Run
            </button>
            <button className="secondary-button" type="button" onClick={stopQuery} disabled={!running}>
              <Pause size={16} />
              Stop
            </button>
          </div>

          {error ? <Notice title="查询失败" error={error} /> : null}

          <section className="answer-panel">
            <div className="panel__title">
              <Search size={18} />
              Answer
              {running ? <span className="live-dot" /> : null}
              {finalStatus ? <span className="soft-label">{finalStatus}</span> : null}
            </div>
            {answer ? <div className="answer-text">{answer}</div> : <EmptyState title="尚未开始查询" detail="回答会随着 NDJSON token 流实时追加。" />}
          </section>
        </div>

        <aside className="context-rail">
          <section className="panel">
            <div className="panel__title">Citations</div>
            {citations.length ? (
              <div className="citation-list">
                {citations.map((citation) => (
                  <article className="citation-item" key={`${citation.n}-${citation.path}-${citation.seq ?? "x"}`}>
                    <div className="citation-item__meta">
                      <span>#{citation.n}</span>
                      <span>{citation.layer}</span>
                      <span>{citation.seq === null ? "seq -" : `seq ${citation.seq}`}</span>
                    </div>
                    <div className="citation-item__path">{citation.path}</div>
                    <p>{citation.excerpt}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="无 citations" />
            )}
          </section>

          <section className="panel">
            <div className="panel__title">Retrieval Hits</div>
            {hits.length ? (
              <div className="mini-table">
                {hits.map((hit) => (
                  <div className="mini-table__row" key={hit.chunk_id}>
                    <span>{formatScore(hit.score)}</span>
                    <span>{hit.layer ?? "-"}</span>
                    <strong>{hit.path ?? hit.doc_id}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="尚无检索命中" />
            )}
          </section>

          <section className="panel">
            <div className="panel__title">Applied Wisdom</div>
            {appliedWisdom.length ? (
              <div className="wisdom-chip-list">
                {appliedWisdom.map((item) => (
                  <span className="wisdom-chip" key={item.item_id}>
                    {item.ref} · {item.kind} · {item.title}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState title="无 applied wisdom" />
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}
