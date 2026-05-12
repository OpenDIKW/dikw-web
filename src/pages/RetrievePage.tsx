import { useRef, useState } from "react";
import { Pause, Play, Sparkles } from "lucide-react";
import { DikwClient } from "../api/client";
import { buildRetrieveAnswerReport } from "../artifacts/builders";
import type { ArtifactDocument } from "../artifacts/types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import type { Hit, PageRef, RetrieveResult } from "../types";
import { formatScore } from "../utils/format";

interface RetrievePageProps {
  client: DikwClient;
  onCreateArtifact?: (artifact: ArtifactDocument) => void;
}

export function RetrievePage({ client, onCreateArtifact }: RetrievePageProps) {
  const [question, setQuestion] = useState("");
  const [limit, setLimit] = useState(10);
  const [previewHits, setPreviewHits] = useState<Hit[]>([]);
  const [chunks, setChunks] = useState<Hit[]>([]);
  const [pageRefs, setPageRefs] = useState<PageRef[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function runRetrieve() {
    const q = question.trim();
    if (!q || running) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setPreviewHits([]);
    setChunks([]);
    setPageRefs([]);
    setError(null);
    setRunning(true);

    try {
      for await (const event of client.streamRetrieve({ q, limit }, controller.signal)) {
        if (event.type === "retrieval_done") {
          setPreviewHits(event.hits);
        } else if (event.type === "final") {
          if (event.status === "succeeded") {
            const result: RetrieveResult = event.result;
            setChunks(result.chunks);
            setPageRefs(result.page_refs);
          } else {
            setError(event.error ? new Error(event.error.message) : new Error(`retrieve ${event.status}`));
          }
        }
      }
    } catch (nextError) {
      if (!controller.signal.aborted) {
        setError(nextError);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Retrieve</p>
          <h1>检索上下文</h1>
        </div>
      </header>

      <section className="panel">
        <div className="query-form query-form--compact">
          <label className="field field--grow">
            <span>Query</span>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="检索 chunk 和 page refs" />
          </label>
          <label className="field field--small">
            <span>Limit</span>
            <input type="number" min={1} max={100} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
          </label>
          <button className="primary-button" type="button" onClick={runRetrieve} disabled={running || !question.trim()}>
            <Play size={16} />
            Run
          </button>
          <button className="secondary-button" type="button" onClick={() => controllerRef.current?.abort()} disabled={!running}>
            <Pause size={16} />
            Stop
          </button>
          {onCreateArtifact && chunks.length ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onCreateArtifact(
                  buildRetrieveAnswerReport({
                    question: question.trim(),
                    limit,
                    chunks,
                    pageRefs
                  })
                )
              }
            >
              <Sparkles size={16} />
              Generate answer report
            </button>
          ) : null}
        </div>
      </section>

      {error ? <Notice title="检索失败" error={error} /> : null}

      <section className="two-column-grid two-column-grid--wide-left">
        <div className="panel">
          <div className="panel__title">Chunks {running ? <span className="live-dot" /> : null}</div>
          {(chunks.length ? chunks : previewHits).length ? (
            <div className="result-table">
              <div className="result-table__head result-table__row">
                <span>Score</span>
                <span>Layer</span>
                <span>Path</span>
                <span>Seq</span>
                <span>Excerpt</span>
              </div>
              {(chunks.length ? chunks : previewHits).map((chunk) => (
                <div className="result-table__row" key={`${chunk.chunk_id}-${chunk.path ?? ""}`}>
                  <span>{formatScore(chunk.score)}</span>
                  <span>{chunk.layer ?? "-"}</span>
                  <strong>{chunk.path ?? chunk.doc_id}</strong>
                  <span>{chunk.seq ?? "-"}</span>
                  <p>{chunk.text ?? chunk.snippet ?? ""}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="尚无 chunks" detail="运行检索后会显示最终 chunks；流式 partial 会先作为预览出现。" />
          )}
        </div>

        <div className="panel">
          <div className="panel__title">Page Refs</div>
          {pageRefs.length ? (
            <div className="page-ref-list">
              {pageRefs.map((ref) => (
                <article className="page-ref" key={ref.path}>
                  <div>
                    <strong>{ref.title ?? ref.path}</strong>
                    <span>{ref.layer ?? "-"}</span>
                  </div>
                  <div className="page-ref__meta">
                    <span>{formatScore(ref.score)}</span>
                    <span>{ref.hit_chunk_ids.join(", ")}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="尚无 page refs" />
          )}
        </div>
      </section>
    </div>
  );
}
