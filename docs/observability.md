# Observability (OpenTelemetry)

dikw-web emits all three OpenTelemetry signals — **traces, metrics, logs** — from
its sidecar, plus optional **browser RUM** traces from the React app. Export is
**opt-in and vendor-neutral**: with no `OTEL_*` endpoint configured the app behaves
exactly as before (agent spans live only in the in-memory `#trace` view, logs print
to stdout, metrics are no-ops). Point it at any OTLP backend and the same signals
flow out, tagged `service.name=dikw-web`.

This doc covers the env reference, the local demo stack, the metric catalog, the
browser-RUM config, and the privacy posture. See `CLAUDE.md` for how the pieces are
wired internally.

## Quickstart — local demo stack

A self-contained stack (OTel Collector → Jaeger + Prometheus + Loki + Grafana) lives
in `docker-compose.observability.yml`. It is separate from the production
`docker-compose.yml` and does not touch it.

```bash
# Backends only (no app credentials needed):
docker compose -f docker-compose.observability.yml up
```

| UI | URL |
|----|-----|
| Grafana (datasources pre-provisioned) | http://localhost:3000 |
| Jaeger (traces) | http://localhost:16686 |
| Prometheus (metrics) | http://localhost:9090 |
| Loki | queried via Grafana |
| Collector OTLP intake | `:4317` (gRPC), `:4318` (HTTP) |

Then run the sidecar pointed at the collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  npm.cmd start
```

Chat a turn (and/or run an import/translate) and you'll see the SERVER → ADK → CLIENT
span tree in Jaeger, `dikw.*` + `http.server.request.duration` in Prometheus, and
structured logs carrying `trace_id` in Loki — all correlated in Grafana.

To run the app **inside** the stack instead (needs LLM creds in `.env`):

```bash
docker compose -f docker-compose.observability.yml --profile app up
```

## Environment reference

All standard `OTEL_*` variables are honored by ADK's exporters; dikw-web adds none of
its own for export. Set them in `.env.local` (dev) or the container environment.

| Variable | Effect |
|----------|--------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP endpoint. Enables trace **and** metric **and** log export. Unset → no export. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `_METRICS_ENDPOINT` / `_LOGS_ENDPOINT` | Per-signal endpoint overrides (e.g. export only traces). Any one enables its signal. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated `key=value` headers for auth — required for Grafana Cloud / Honeycomb / Datadog (e.g. `x-honeycomb-team=<key>` or `authorization=Bearer <token>`). |
| `OTEL_SERVICE_NAME` | Overrides the `service.name` resource attribute (default `dikw-web`). |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Sampling strategy, e.g. `parentbased_traceidratio` + `0.1` for 10%. Default: always-on. **See the sampling limitation below.** |
| `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS` | Forced to `false` by the app — conversation content / raw tool I/O never enters spans, in-memory or OTLP-exported. |
| `DIKW_LOG_FORMAT` | `text` forces human-readable sidecar stdout (default is JSON; auto-text on a TTY). Independent of OTLP log export. |

### Sampling is env-only

Sampling is driven entirely by `OTEL_TRACES_SAMPLER` / `_ARG`, which ADK's
`NodeTracerProvider` reads from the environment. A **custom `Sampler` class is not
supported** — the app does not construct its own SDK, it injects processors into
ADK's. Use the env samplers (`always_on`, `always_off`, `traceidratio`,
`parentbased_*`) for any sampling policy.

## Metric catalog

Pushed over OTLP when an endpoint is configured (no-ops otherwise). Prometheus
renders dots as underscores (`dikw_job_duration`).

| Metric | Type | Attributes | Meaning |
|--------|------|------------|---------|
| `http.server.request.duration` | histogram (s) | `http.request.method`, `http.route`, `http.response.status_code` | Per inbound `/agent` · `/web` request. Route is templated (`:id`), never the raw path. |
| `dikw.job.duration` | histogram (s) | `dikw.job.family` = `mineru`\|`translate`, `dikw.job.outcome` = `succeeded`\|`failed` | Detached conversion / translation wall-clock. |
| `dikw.job.count` | counter | same as above | Completed detached jobs. |
| `dikw.job.inflight` | up/down counter | `dikw.job.family` | Live detached jobs (±1 across each run). |
| `dikw.llm.tokens` | counter | `gen_ai.token.type` = `input`\|`output` | LLM token usage, parsed from ADK spans. |
| `dikw.agent.turn.duration` | histogram (s) | `dikw.agent.turn.outcome` = `ok`\|`error`\|`aborted` | Per chat turn (`runMessage`). |

## Browser RUM (frontend traces)

The React app can emit document-load + fetch spans (`service.name=dikw-web-browser`)
that stitch into the sidecar's SERVER span for a browser → sidecar → ADK trace. It is
**opt-in, default-off, and lazy-loaded** (the OTel web SDK is dynamic-imported, so it
stays out of the entry bundle and downloads nothing unless enabled).

Enable it per deployment via the runtime `public/config.json` (gitignored; see
`public/config.example.json`, which ships it **disabled** with an empty endpoint):

```json
{
  "telemetry": {
    "endpoint": "https://collector.example.com/v1/traces",
    "headers": { "authorization": "Bearer <token>" }
  }
}
```

- `endpoint` is the **full OTLP/HTTP traces URL** (ends in `/v1/traces`). Empty or
  missing → RUM stays off.
- The collector must allow the app origin through **CORS** (the demo collector config
  lists `http://localhost:4321`; add your deployed origin).
- **Security:** any `headers` you set here are served to and sent by the browser, so a
  token placed here is **client-visible by nature**. Prefer a collector that accepts
  unauthenticated requests from your app origin (doing auth at the collector → backend
  hop), or a narrowly-scoped ingest token. Never reuse a privileged token.

`traceparent` is propagated only to **same-origin** requests (the sidecar's `/agent` +
`/web`); a cross-origin core (`/v1`) receives none. Fetch-span URLs are **redacted
before export** — the query string is dropped and high-cardinality id segments are
templated — so user-derived values (e.g. an uploaded filename) never reach the
collector.

## Privacy posture

- Conversation content and raw tool I/O are never captured in spans
  (`ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`), in-memory or exported.
- SERVER spans export `http.route` (templated), never the raw path or query.
- Outbound CLIENT spans redact the query string (MinerU presigned-URL credentials
  never leave the process).
- The sidecar logger redacts field **names** matching `key|token|auth|secret|password|credential`.
- Browser fetch-span URLs are query-stripped and id-templated (above).

## Cloud backends

No code change — just set the endpoint and auth header:

```bash
# Honeycomb
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<api-key>

# Grafana Cloud (OTLP gateway)
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic <base64 instanceID:token>
```

## The in-memory `#trace` view is unaffected

The hidden `#trace` page reads agent spans from an ephemeral in-memory `SpanStore`
(lost on sidecar restart). It is always on and independent of OTLP export — with no
endpoint configured it is the only sink. OTLP export runs **alongside** it; the
HTTP-infrastructure SERVER/CLIENT spans are filtered out of `#trace` (it shows
agent-only INTERNAL spans) but still export over OTLP.
