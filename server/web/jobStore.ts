// In-memory job store for detached MinerU conversions (issue #60).
//
// The convert pipeline (submit → upload → poll[up to 10 min] → download →
// tar+gzip) used to run inside a single HTTP request, so its time-to-first-byte
// equalled the whole conversion time — any reverse proxy / tunnel with a request
// timeout below that (Cloudflare free ~100s, nginx 60s) cut the connection
// mid-flight. We now run the pipeline detached from the request and track it
// here: the browser submits, polls a short `GET /web/mineru/jobs/<id>`, then
// fetches the result. Every request stays seconds-short.
//
// In-memory only (no disk persistence): a sidecar restart drops live jobs, and
// `converting` stays non-resumable across a browser refresh — matching the v1
// stance in src/state/import-pipeline.ts. Result reads are idempotent (see
// peekResult), so results linger until the TTL sweep or byte-cap eviction
// reclaims them — eviction is mandatory, not optional.

import { randomUUID } from "node:crypto";

export type JobStatus = "pending" | "running" | "succeeded" | "failed";
export type JobPhase = "uploading" | "polling" | "downloading";

export interface JobError {
  code: string;
  message: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  /** Coarse progress hint for the status endpoint; the browser drives its own
   *  substage off `status`, not this. Present only while running. */
  phase?: JobPhase;
  /** Opaque progress payload echoed verbatim by the status endpoint while the
   *  job runs. The store does not interpret it — the translate runner uses it to
   *  publish `{ done, total, blocks }` so the browser can reveal partial blocks
   *  progressively instead of waiting for the whole document. */
  progress?: unknown;
  /** Set when status is "failed"; carries the same wire code the browser's
   *  pickErrorCode understands (mineru_auth / mineru_quota / …). */
  error?: JobError;
  /** The gzipped tar; present only when status is "succeeded". */
  result?: Uint8Array;
  /** Aborted by POST /web/mineru/jobs/<id>/cancel; signal is threaded into the
   *  MinerU client so a cancel breaks the poll loop promptly. */
  controller: AbortController;
  createdAt: number;
  finishedAt?: number;
}

/** Thrown by create() when too many jobs are live — surfaced as 503. */
export class JobLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobLimitError";
  }
}

// Keep a finished job's result fetchable long enough for the browser to poll
// "succeeded" and then fetch /result — but bounded so abandoned results don't
// linger. Far larger than the ~1.5s poll→fetch gap.
const TERMINAL_TTL_MS = 10 * 60_000;
// Bound concurrent detached conversions. The browser caps its own batch at 2
// workers/tab; this guards a shared singleton against many tabs / a buggy
// client spawning unbounded 10-min pipelines (each burns MinerU quota).
const MAX_LIVE_JOBS = 16;
// Bound the in-memory footprint of held results.
const MAX_TOTAL_RESULT_BYTES = 512 * 1024 * 1024;

export interface JobStoreOptions {
  now?: () => number;
  terminalTtlMs?: number;
  maxLiveJobs?: number;
  maxTotalResultBytes?: number;
}

function isTerminal(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed";
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly now: () => number;
  private readonly terminalTtlMs: number;
  private readonly maxLiveJobs: number;
  private readonly maxTotalResultBytes: number;
  private totalResultBytes = 0;

  constructor(opts: JobStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.terminalTtlMs = opts.terminalTtlMs ?? TERMINAL_TTL_MS;
    this.maxLiveJobs = opts.maxLiveJobs ?? MAX_LIVE_JOBS;
    this.maxTotalResultBytes = opts.maxTotalResultBytes ?? MAX_TOTAL_RESULT_BYTES;
  }

  create(controller: AbortController): Job {
    this.sweep();
    // Cap only LIVE (pending/running) conversions. Terminal jobs awaiting a
    // result fetch or the TTL sweep must NOT lock out new submits — otherwise a
    // batch that fails fast (e.g. every file hits mineru_quota) would jam the
    // queue with `failed` records for the full TTL window.
    if (this.countLive() >= this.maxLiveJobs) {
      throw new JobLimitError(`too many concurrent conversion jobs (max ${this.maxLiveJobs})`);
    }
    const job: Job = {
      id: randomUUID(),
      status: "pending",
      controller,
      createdAt: this.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    this.sweep();
    return this.jobs.get(id);
  }

  setRunning(id: string): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return;
    job.status = "running";
  }

  setPhase(id: string, phase: JobPhase): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return;
    job.phase = phase;
  }

  /** Publish an opaque progress payload for the status endpoint. No-op once the
   *  job is terminal (a late batch callback must not resurrect a cancelled job). */
  setProgress(id: string, progress: unknown): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return;
    job.progress = progress;
  }

  setSucceeded(id: string, result: Uint8Array): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return;
    job.status = "succeeded";
    job.result = result;
    job.finishedAt = this.now();
    this.totalResultBytes += result.byteLength;
    this.enforceResultCap(id);
  }

  setFailed(id: string, error: JobError): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return;
    job.status = "failed";
    job.error = error;
    job.finishedAt = this.now();
  }

  /** Return a succeeded job's result WITHOUT removing it — result reads are
   *  idempotent within the TTL window. A `/result` HTTP response can be cut
   *  mid-transfer by a flaky proxy (the exact transport failure issue #60 is
   *  about); deleting on first read would defeat the client's retry and lose a
   *  finished conversion, forcing the user to re-spend MinerU quota. Reclaim is
   *  therefore left entirely to the TTL sweep and byte-cap eviction. */
  peekResult(id: string): Uint8Array | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status !== "succeeded" || !job.result) return undefined;
    return job.result;
  }

  size(): number {
    return this.jobs.size;
  }

  private countLive(): number {
    let live = 0;
    for (const job of this.jobs.values()) {
      if (!isTerminal(job.status)) live += 1;
    }
    return live;
  }

  private remove(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.result) this.totalResultBytes -= job.result.byteLength;
    this.jobs.delete(id);
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== undefined && now - job.finishedAt > this.terminalTtlMs) {
        this.remove(id);
      }
    }
  }

  private enforceResultCap(protectId: string): void {
    if (this.totalResultBytes <= this.maxTotalResultBytes) return;
    // Evict oldest terminal jobs (by finishedAt) until under the cap — but never
    // the job we just stored (`protectId`); the browser is about to fetch it. A
    // single result larger than the cap is kept rather than dropped (the cap
    // bounds *accumulation*, not one oversized item).
    const evictable = Array.from(this.jobs.values())
      .filter(
        (j): j is Job & { finishedAt: number } => j.finishedAt !== undefined && j.id !== protectId,
      )
      .sort((a, b) => a.finishedAt - b.finishedAt);
    for (const job of evictable) {
      if (this.totalResultBytes <= this.maxTotalResultBytes) break;
      this.remove(job.id);
    }
  }
}
