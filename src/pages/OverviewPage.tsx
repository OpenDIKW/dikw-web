import { useCallback } from "react";
import { RefreshCw, Server, Shield, Waypoints } from "lucide-react";
import { DikwClient } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import type { InfoResponse, ReadyResponse, StorageCounts } from "../types";
import { formatNumber, formatUnixSeconds } from "../utils/format";

interface OverviewPageProps {
  client: DikwClient;
}

interface OverviewData {
  info: InfoResponse;
  ready: ReadyResponse;
  status: StorageCounts;
}

export function OverviewPage({ client }: OverviewPageProps) {
  const load = useCallback(
    async (signal: AbortSignal): Promise<OverviewData> => {
      const [info, ready, status] = await Promise.all([
        client.get<InfoResponse>("/v1/info", { signal }),
        client.get<ReadyResponse>("/v1/readyz", { signal }),
        client.get<StorageCounts>("/v1/status", { signal })
      ]);
      return { info, ready, status };
    },
    [client]
  );
  const resource = useAsyncResource(load, [client]);
  const data = resource.data;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>工作台概览</h1>
        </div>
        <button className="icon-button" type="button" onClick={resource.reload} aria-label="刷新概览">
          <RefreshCw size={18} />
        </button>
      </header>

      {resource.error ? <Notice title="无法读取 dikw-core 状态" error={resource.error} /> : null}

      <section className="overview-grid">
        <MetricCard
          label="Server"
          value={data ? <StatusPill status={data.ready.status} /> : resource.loading ? "Loading" : "-"}
          detail={data?.info.engine_version ? `dikw-core ${data.info.engine_version}` : undefined}
        />
        <MetricCard label="Data" value={formatNumber(data?.status.documents_by_layer.source)} detail="source documents" />
        <MetricCard label="Information" value={formatNumber(data?.status.chunks)} detail={`${formatNumber(data?.status.embeddings)} embeddings`} />
        <MetricCard label="Knowledge" value={formatNumber(data?.status.documents_by_layer.wiki)} detail={`${formatNumber(data?.status.links)} links`} />
        <MetricCard
          label="Wisdom"
          value={formatNumber(data?.status.documents_by_layer.wisdom)}
          detail={`${formatNumber(data?.status.wisdom_by_status.candidate)} candidates`}
        />
        <MetricCard label="Assets" value={formatNumber(data?.status.assets)} detail={`${formatNumber(data?.status.asset_embeddings)} asset embeddings`} />
      </section>

      {data ? (
        <section className="two-column-grid">
          <div className="panel">
            <div className="panel__title">
              <Server size={18} />
              Runtime
            </div>
            <dl className="detail-list">
              <div>
                <dt>wiki root</dt>
                <dd>{data.info.wiki_root}</dd>
              </div>
              <div>
                <dt>storage</dt>
                <dd>{data.info.storage_backend}</dd>
              </div>
              <div>
                <dt>last log</dt>
                <dd>{formatUnixSeconds(data.status.last_wiki_log_ts)}</dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <div className="panel__title">
              <Waypoints size={18} />
              Providers
            </div>
            <dl className="detail-list">
              <div>
                <dt>LLM</dt>
                <dd>{data.info.providers.llm} · {data.info.providers.llm_model}</dd>
              </div>
              <div>
                <dt>Embedding</dt>
                <dd>{data.info.providers.embedding} · {data.info.providers.embedding_model}</dd>
              </div>
              <div>
                <dt>Auth</dt>
                <dd>
                  <Shield size={14} aria-hidden="true" />
                  {data.info.auth_required ? "required" : "not required"}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      ) : null}
    </div>
  );
}
