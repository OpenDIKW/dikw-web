import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import type { WisdomItem, WisdomKind, WisdomStatus } from "../types";
import { formatPercent, formatUnixSeconds } from "../utils/format";

interface WisdomPageProps {
  client: DikwClient;
  locale?: Locale;
}

const statuses: Array<"" | WisdomStatus> = ["", "candidate", "approved", "archived"];
const kinds: Array<"" | WisdomKind> = ["", "principle", "lesson", "pattern"];

export function WisdomPage({ client, locale = "en" }: WisdomPageProps) {
  const copy = translations[locale].pages.wisdom;
  const [status, setStatus] = useState<"" | WisdomStatus>("");
  const [kind, setKind] = useState<"" | WisdomKind>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      client.get<WisdomItem[]>("/v1/wisdom", {
        signal,
        params: {
          status: status || undefined,
          kind: kind || undefined
        }
      }),
    [client, kind, status]
  );
  const wisdom = useAsyncResource(load, [client, kind, status]);
  const items = useMemo(() => wisdom.data ?? [], [wisdom.data]);
  const selected = useMemo(
    () => items.find((item) => item.item_id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.item_id === selectedId)) {
      setSelectedId(items[0].item_id);
    }
  }, [items, selectedId]);

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={wisdom.reload} aria-label={copy.refresh}>
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="panel filter-bar">
        <label className="field">
          <span>{copy.statusLabel}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | WisdomStatus)}>
            {statuses.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{copy.kindLabel}</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as "" | WisdomKind)}>
            {kinds.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
      </section>

      {wisdom.error ? <Notice title={copy.errorTitle} error={wisdom.error} /> : null}

      <section className="wisdom-layout">
        <aside className="panel wisdom-list-panel">
          <div className="section-title">
            <span>Insight library</span>
            <span className="soft-label">{items.length} items</span>
          </div>
          {items.length ? (
            <div className="wisdom-list" role="list" aria-label="Wisdom library">
              {items.map((item) => (
                <div role="listitem" key={item.item_id}>
                  <button
                    className={`wisdom-list__item ${selected?.item_id === item.item_id ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setSelectedId(item.item_id)}
                  >
                    <span className="wisdom-list__topline">
                      <strong>{item.title}</strong>
                      <StatusPill status={item.status} />
                    </span>
                    <span className="wisdom-list__body">{item.body}</span>
                    <span className="wisdom-list__meta">
                      <span>{item.kind}</span>
                      <span>{formatPercent(item.confidence)}</span>
                      <span>{formatUnixSeconds(item.created_ts)}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : !wisdom.loading ? (
            <EmptyState title={copy.emptyList} />
          ) : (
            <EmptyState title={copy.loadingList} />
          )}
        </aside>

        <section className="panel wisdom-detail" aria-label="Wisdom detail">
          {selected ? (
            <>
              <div className="wisdom-card__top">
                <div>
                  <div className="reader-header__path">{selected.item_id}</div>
                  <h2>{selected.title}</h2>
                </div>
                <div className="reader-header__meta">
                  <StatusPill status={selected.status} />
                  <span className="soft-label">{selected.kind}</span>
                </div>
              </div>
              <p className="wisdom-detail__body">{selected.body}</p>
              <dl className="detail-list detail-list--inline">
                <div>
                  <dt>confidence</dt>
                  <dd>{formatPercent(selected.confidence)}</dd>
                </div>
                <div>
                  <dt>created</dt>
                  <dd>{formatUnixSeconds(selected.created_ts)}</dd>
                </div>
                <div>
                  <dt>source path</dt>
                  <dd>{selected.path || "-"}</dd>
                </div>
                <div>
                  <dt>approved</dt>
                  <dd>{selected.approved_ts ? formatUnixSeconds(selected.approved_ts) : "-"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <EmptyState title={copy.selectItem} />
          )}
        </section>
      </section>
    </div>
  );
}
