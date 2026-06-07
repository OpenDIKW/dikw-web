import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { translations, type Locale } from "../i18n";
import type { Hit, PageRef, RetrieveResult } from "../types";
import { formatScore } from "../utils/format";

interface RetrievePageProps {
  client: DikwClient;
  locale?: Locale;
}

export function RetrievePage({ client, locale = "en" }: RetrievePageProps) {
  const copy = translations[locale].pages.retrieve;
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
            setError(
              event.error ? new Error(event.error.message) : new Error(`retrieve ${event.status}`),
            );
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
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
      </header>

      <section className="panel">
        <div className="query-form query-form--compact">
          <label className="field field--grow">
            <span>{copy.queryLabel}</span>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.queryPlaceholder}
            />
          </label>
          <label className="field field--small">
            <span>{copy.limitLabel}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={runRetrieve}
            disabled={running || !question.trim()}
          >
            <Play size={16} />
            {copy.run}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => controllerRef.current?.abort()}
            disabled={!running}
          >
            <Pause size={16} />
            {copy.stop}
          </button>
        </div>
      </section>

      {error ? <Notice title={copy.errorTitle} error={error} /> : null}

      <section className="two-column-grid two-column-grid--wide-left">
        <div className="panel">
          <div className="panel__title">
            {copy.chunksTitle} {running ? <span className="live-dot" /> : null}
          </div>
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
            <EmptyState title={copy.emptyChunks} detail={copy.emptyChunksDetail} />
          )}
        </div>

        <div className="panel">
          <div className="panel__title">{copy.pageRefsTitle}</div>
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
            <EmptyState title={copy.emptyPageRefs} />
          )}
        </div>
      </section>
    </div>
  );
}
