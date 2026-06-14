// dikw-web sidecar metrics (OTel). Records `http.server.request.duration` plus a
// small `dikw.*` family. Export is entirely ADK's: when OTEL_EXPORTER_OTLP_ENDPOINT
// (or *_METRICS_ENDPOINT) is set, maybeSetOtelProviders builds a MeterProvider with
// an OTLP PeriodicExportingMetricReader (see server/agent/telemetry.ts), so these
// instruments flow out over OTLP. With no endpoint env, no MeterProvider is
// registered and metrics.getMeter() returns the API no-op — every record() below is
// a no-op, never throwing. Nothing here touches dikw-core.
//
// Instruments bind LAZILY (first record), never at module load: the global
// MeterProvider is finalized at sidecar boot inside initAgentTelemetry, and the
// first record always happens later (handling a request/job/turn), so binding then
// picks up whichever provider boot installed.

import {
  type Attributes,
  type Counter,
  type Histogram,
  metrics,
  type UpDownCounter,
} from "@opentelemetry/api";

const METER_NAME = "dikw-web";

export type JobFamily = "mineru" | "translate";
export type JobOutcome = "succeeded" | "failed";
export type TurnOutcome = "ok" | "aborted" | "error";
export type TokenDirection = "input" | "output";

interface Instruments {
  httpServerDuration: Histogram;
  jobDuration: Histogram;
  jobCount: Counter;
  jobInflight: UpDownCounter;
  llmTokens: Counter;
  agentTurnDuration: Histogram;
}

let cached: Instruments | null = null;

function instruments(): Instruments {
  if (cached) {
    return cached;
  }
  const meter = metrics.getMeter(METER_NAME);
  cached = {
    httpServerDuration: meter.createHistogram("http.server.request.duration", {
      unit: "s",
      description: "Duration of inbound HTTP requests handled by the sidecar.",
    }),
    jobDuration: meter.createHistogram("dikw.job.duration", {
      unit: "s",
      description: "Duration of a detached sidecar job (mineru conversion / translation).",
    }),
    jobCount: meter.createCounter("dikw.job.count", {
      unit: "{job}",
      description: "Detached sidecar jobs that reached a terminal state, by family and outcome.",
    }),
    jobInflight: meter.createUpDownCounter("dikw.job.inflight", {
      unit: "{job}",
      description: "Detached sidecar jobs currently running, by family.",
    }),
    llmTokens: meter.createCounter("dikw.llm.tokens", {
      unit: "{token}",
      description: "LLM tokens consumed by the agent, by direction.",
    }),
    agentTurnDuration: meter.createHistogram("dikw.agent.turn.duration", {
      unit: "s",
      description: "Wall-clock duration of one agent turn (runMessage), by outcome.",
    }),
  };
  return cached;
}

export function recordHttpServerDuration(
  seconds: number,
  attrs: { method: string; route: string; statusCode: number },
): void {
  instruments().httpServerDuration.record(seconds, {
    "http.request.method": attrs.method,
    "http.route": attrs.route,
    "http.response.status_code": attrs.statusCode,
  });
}

export function recordJobStart(family: JobFamily): void {
  instruments().jobInflight.add(1, { "dikw.job.family": family });
}

export function recordJobEnd(family: JobFamily, outcome: JobOutcome, seconds: number): void {
  const attrs: Attributes = { "dikw.job.family": family, "dikw.job.outcome": outcome };
  const inst = instruments();
  inst.jobInflight.add(-1, { "dikw.job.family": family });
  inst.jobDuration.record(seconds, attrs);
  inst.jobCount.add(1, attrs);
}

export function recordLlmTokens(direction: TokenDirection, tokens: number): void {
  instruments().llmTokens.add(tokens, { "gen_ai.token.type": direction });
}

export function recordAgentTurnDuration(seconds: number, outcome: TurnOutcome): void {
  instruments().agentTurnDuration.record(seconds, { "dikw.agent.turn.outcome": outcome });
}
