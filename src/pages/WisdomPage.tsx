import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DikwClient } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import type { WisdomItem, WisdomKind, WisdomStatus } from "../types";
import { formatPercent, formatUnixSeconds } from "../utils/format";

interface WisdomPageProps {
  client: DikwClient;
}

const statuses: Array<"" | WisdomStatus> = ["", "candidate", "approved", "archived"];
const kinds: Array<"" | WisdomKind> = ["", "principle", "lesson", "pattern"];

export function WisdomPage({ client }: WisdomPageProps) {
  const [status, setStatus] = useState<"" | WisdomStatus>("");
  const [kind, setKind] = useState<"" | WisdomKind>("");

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

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Wisdom Layer</p>
          <h1>智慧沉淀</h1>
        </div>
        <button className="icon-button" type="button" onClick={wisdom.reload} aria-label="刷新智慧条目">
          <RefreshCw size={18} />
        </button>
      </header>

      <section className="panel filter-bar">
        <label className="field">
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | WisdomStatus)}>
            {statuses.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>类型</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as "" | WisdomKind)}>
            {kinds.map((value) => (
              <option value={value} key={value || "all"}>
                {value || "all"}
              </option>
            ))}
          </select>
        </label>
      </section>

      {wisdom.error ? <Notice title="无法读取智慧条目" error={wisdom.error} /> : null}

      <section className="wisdom-grid">
        {(wisdom.data ?? []).map((item) => (
          <article className="wisdom-card" key={item.item_id}>
            <div className="wisdom-card__top">
              <StatusPill status={item.status} />
              <span className="soft-label">{item.kind}</span>
            </div>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <dl className="compact-dl">
              <div>
                <dt>confidence</dt>
                <dd>{formatPercent(item.confidence)}</dd>
              </div>
              <div>
                <dt>created</dt>
                <dd>{formatUnixSeconds(item.created_ts)}</dd>
              </div>
              <div>
                <dt>id</dt>
                <dd>{item.item_id}</dd>
              </div>
            </dl>
          </article>
        ))}
        {!wisdom.loading && !(wisdom.data ?? []).length ? <EmptyState title="暂无智慧条目" /> : null}
      </section>
    </div>
  );
}
