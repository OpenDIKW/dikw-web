import { useCallback } from "react";
import { RefreshCw, Server, Shield, Waypoints } from "lucide-react";
import { DikwClient } from "../api/client";
import { IconButton } from "../components/IconButton";
import { MetricCard } from "../components/MetricCard";
import { Notice } from "../components/Notice";
import { StatusPill } from "../components/StatusPill";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { translations, type Locale } from "../i18n";
import type { HealthReport, InfoResponse, StorageCounts } from "../types";
import { formatClockTime, formatNumber, formatUnixSeconds } from "../utils/format";

interface OverviewPageProps {
  client: DikwClient;
  locale?: Locale;
}

interface OverviewData {
  health: HealthReport;
  info: InfoResponse;
  status: StorageCounts;
  fetchedAt: Date;
}

function Skeleton() {
  return <span className="metric-skeleton" data-testid="metric-skeleton" aria-hidden="true" />;
}

export function OverviewPage({ client, locale = "en" }: OverviewPageProps) {
  const copy = translations[locale].pages.overview;
  const load = useCallback(
    async (signal: AbortSignal): Promise<OverviewData> => {
      const [health, info, status] = await Promise.all([
        client.get<HealthReport>("/v1/health", { signal }),
        client.get<InfoResponse>("/v1/info", { signal }),
        client.get<StorageCounts>("/v1/status", { signal }),
      ]);
      return { health, info, status, fetchedAt: new Date() };
    },
    [client],
  );
  const resource = useAsyncResource(load, [client]);
  const data = resource.data;
  // Initial load: no data yet and no error → skeletons. A failed first load shows
  // only the Notice (no half-rendered strip); a failed *refresh* keeps stale data.
  const showSkeleton = resource.loading && !data;
  const showBody = Boolean(data) || showSkeleton;

  return (
    <div className="page-stack">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
        </div>
        <div className="page-header__actions">
          {data ? (
            <span className="page-header__meta" data-testid="overview-updated">
              {copy.updated} {formatClockTime(data.fetchedAt)}
            </span>
          ) : null}
          <IconButton label={copy.refresh} onClick={resource.reload} aria-busy={resource.loading}>
            <RefreshCw
              size={18}
              className={resource.loading ? "spin" : undefined}
              aria-hidden="true"
            />
          </IconButton>
        </div>
      </header>

      {resource.error ? <Notice title={copy.errorTitle} error={resource.error} /> : null}

      {showBody ? (
        <>
          <dl className="overview-grid">
            <MetricCard
              label="Server"
              value={data ? <StatusPill status={data.health.status} /> : <Skeleton />}
              detail={
                data ? (
                  data.health.version ? (
                    `dikw-core ${data.health.version}`
                  ) : undefined
                ) : (
                  <Skeleton />
                )
              }
            />
            <MetricCard
              label="Data"
              value={data ? formatNumber(data.health.layer_counts.sources) : <Skeleton />}
              detail={data ? "source documents" : <Skeleton />}
              href={data ? "#base" : undefined}
            />
            <MetricCard
              label="Information"
              value={data ? formatNumber(data.health.layer_counts.chunks) : <Skeleton />}
              detail={data ? `${formatNumber(data.status.embeddings)} embeddings` : <Skeleton />}
            />
            <MetricCard
              label="Knowledge"
              value={data ? formatNumber(data.health.layer_counts.knowledge_pages) : <Skeleton />}
              detail={data ? `${formatNumber(data.status.links)} links` : <Skeleton />}
              href={data ? "#graph" : undefined}
            />
            <MetricCard
              label="Wisdom"
              value={data ? formatNumber(data.health.layer_counts.wisdom_items) : <Skeleton />}
              detail={data ? "wisdom items" : <Skeleton />}
              href={data ? "#wisdom" : undefined}
            />
            <MetricCard
              label="Assets"
              value={data ? formatNumber(data.status.assets) : <Skeleton />}
              detail={
                data ? (
                  `${formatNumber(data.status.asset_embeddings)} asset embeddings`
                ) : (
                  <Skeleton />
                )
              }
            />
          </dl>

          <section className="two-column-grid">
            <div className="panel">
              <div className="panel__title">
                <Server size={18} />
                Runtime
              </div>
              <dl className="detail-list">
                <div>
                  <dt>base root</dt>
                  <dd>{data ? data.health.base_root : <Skeleton />}</dd>
                </div>
                <div>
                  <dt>storage</dt>
                  <dd>{data ? data.health.storage_engine : <Skeleton />}</dd>
                </div>
                <div>
                  <dt>last log</dt>
                  <dd>
                    {data ? formatUnixSeconds(data.status.last_knowledge_log_ts) : <Skeleton />}
                  </dd>
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
                  <dd>
                    {data ? (
                      `${data.health.providers.llm.provider} · ${data.health.providers.llm.model}`
                    ) : (
                      <Skeleton />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Embedding</dt>
                  <dd>
                    {data ? (
                      `${data.health.providers.embedding.provider} · ${data.health.providers.embedding.model}`
                    ) : (
                      <Skeleton />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Auth</dt>
                  <dd>
                    {data ? (
                      <>
                        <Shield size={14} aria-hidden="true" />
                        {data.info.auth_required ? "required" : "not required"}
                      </>
                    ) : (
                      <Skeleton />
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
