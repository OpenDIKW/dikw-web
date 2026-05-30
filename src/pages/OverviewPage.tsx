import { useCallback } from "react";
import { RefreshCw, Server, Shield, Waypoints } from "lucide-react";
import { DikwClient } from "../api/client";
import { MetricCard } from "../components/MetricCard";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import type { HealthReport, InfoResponse, StorageCounts } from "../types";
import { formatNumber, formatUnixSeconds } from "../utils/format";

interface OverviewPageProps {
  client: DikwClient;
  locale?: Locale;
}

interface OverviewData {
  health: HealthReport;
  info: InfoResponse;
  status: StorageCounts;
}

export function OverviewPage({ client, locale = "en" }: OverviewPageProps) {
  const copy = translations[locale].pages.overview;
  const load = useCallback(
    async (signal: AbortSignal): Promise<OverviewData> => {
      const [health, info, status] = await Promise.all([
        client.get<HealthReport>("/v1/health", { signal }),
        client.get<InfoResponse>("/v1/info", { signal }),
        client.get<StorageCounts>("/v1/status", { signal })
      ]);
      return { health, info, status };
    },
    [client]
  );
  const resource = useAsyncResource(load, [client]);
  const data = resource.data;

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={resource.reload} aria-label={copy.refresh}>
          <RefreshCw size={18} />
        </button>
      </header>

      {resource.error ? <Notice title={copy.errorTitle} error={resource.error} /> : null}

      <section className="overview-grid">
        <MetricCard
          label="Server"
          value={data ? <StatusPill status={data.health.status} /> : resource.loading ? "Loading" : "-"}
          detail={data?.health.version ? `dikw-core ${data.health.version}` : undefined}
        />
        <MetricCard label="Data" value={formatNumber(data?.health.layer_counts.sources)} detail="source documents" />
        <MetricCard label="Information" value={formatNumber(data?.health.layer_counts.chunks)} detail={`${formatNumber(data?.status.embeddings)} embeddings`} />
        <MetricCard label="Knowledge" value={formatNumber(data?.health.layer_counts.knowledge_pages)} detail={`${formatNumber(data?.status.links)} links`} />
        <MetricCard
          label="Wisdom"
          value={formatNumber(data?.health.layer_counts.wisdom_items)}
          detail="wisdom items"
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
                <dt>base root</dt>
                <dd>{data.health.base_root}</dd>
              </div>
              <div>
                <dt>storage</dt>
                <dd>{data.health.storage_engine}</dd>
              </div>
              <div>
                <dt>last log</dt>
                <dd>{formatUnixSeconds(data.status.last_knowledge_log_ts)}</dd>
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
                <dd>{data.health.providers.llm.provider} · {data.health.providers.llm.model}</dd>
              </div>
              <div>
                <dt>Embedding</dt>
                <dd>{data.health.providers.embedding.provider} · {data.health.providers.embedding.model}</dd>
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
