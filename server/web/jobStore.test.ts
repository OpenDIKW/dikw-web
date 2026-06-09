// @vitest-environment node
//
// Unit tests for the in-memory MinerU job store (issue #60). No HTTP, no
// network — just the lifecycle + eviction logic that lets a conversion run
// detached from the request that created it, so no single request approaches
// a reverse-proxy timeout.

import { describe, expect, it } from "vitest";
import { JobLimitError, JobStore } from "./jobStore";

function fixedClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("JobStore lifecycle", () => {
  it("creates jobs with unique ids in pending state", () => {
    const store = new JobStore();
    const a = store.create(new AbortController());
    const b = store.create(new AbortController());
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe("pending");
    expect(store.get(a.id)?.status).toBe("pending");
  });

  it("transitions running → phase → succeeded with finishedAt + result", () => {
    const clock = fixedClock(1000);
    const store = new JobStore({ now: clock.now });
    const job = store.create(new AbortController());
    store.setRunning(job.id);
    expect(store.get(job.id)?.status).toBe("running");
    store.setPhase(job.id, "polling");
    expect(store.get(job.id)?.phase).toBe("polling");
    clock.advance(5);
    store.setSucceeded(job.id, new Uint8Array([1, 2, 3]));
    const done = store.get(job.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.finishedAt).toBe(1005);
    expect(Array.from(done?.result ?? [])).toEqual([1, 2, 3]);
  });

  it("publishes an opaque progress payload while running and ignores it once terminal", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setRunning(job.id);
    store.setProgress(job.id, { done: 1, total: 3, blocks: [{ i: 0, tr: "你好" }] });
    expect(store.get(job.id)?.progress).toEqual({
      done: 1,
      total: 3,
      blocks: [{ i: 0, tr: "你好" }],
    });
    // A late batch callback after the job already finished must not mutate it.
    store.setSucceeded(job.id, new Uint8Array([1]));
    store.setProgress(job.id, { done: 3, total: 3, blocks: [] });
    expect(store.get(job.id)?.progress).toEqual({
      done: 1,
      total: 3,
      blocks: [{ i: 0, tr: "你好" }],
    });
  });

  it("records a failure with error code/message", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setFailed(job.id, { code: "mineru_quota", message: "quota" });
    const failed = store.get(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toEqual({ code: "mineru_quota", message: "quota" });
  });
});

describe("JobStore terminal guards", () => {
  it("ignores setSucceeded after a job already failed", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setFailed(job.id, { code: "mineru_api", message: "boom" });
    store.setSucceeded(job.id, new Uint8Array([9]));
    expect(store.get(job.id)?.status).toBe("failed");
  });

  it("ignores setPhase after a job succeeded", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setSucceeded(job.id, new Uint8Array([1]));
    store.setPhase(job.id, "downloading");
    expect(store.get(job.id)?.phase).toBeUndefined();
  });

  it("never throws when mutating an unknown / evicted job id", () => {
    const store = new JobStore();
    expect(() => {
      store.setRunning("nope");
      store.setPhase("nope", "polling");
      store.setSucceeded("nope", new Uint8Array([1]));
      store.setFailed("nope", { code: "x", message: "y" });
    }).not.toThrow();
  });
});

describe("JobStore peekResult (idempotent)", () => {
  it("returns the result without removing the job, so repeated reads succeed", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setSucceeded(job.id, new Uint8Array([4, 5, 6]));
    // Reading the result must NOT consume it — a cut /result transfer is retried
    // (issue #60), so the second read has to return the same bytes, not undefined.
    expect(Array.from(store.peekResult(job.id) ?? [])).toEqual([4, 5, 6]);
    expect(store.get(job.id)?.status).toBe("succeeded");
    expect(Array.from(store.peekResult(job.id) ?? [])).toEqual([4, 5, 6]);
  });

  it("returns undefined for a job that has not succeeded", () => {
    const store = new JobStore();
    const job = store.create(new AbortController());
    store.setRunning(job.id);
    expect(store.peekResult(job.id)).toBeUndefined();
    expect(store.get(job.id)?.status).toBe("running");
  });
});

describe("JobStore eviction", () => {
  it("lazily evicts terminal jobs past the TTL on next access", () => {
    const clock = fixedClock(0);
    const store = new JobStore({ now: clock.now, terminalTtlMs: 1000 });
    const job = store.create(new AbortController());
    store.setSucceeded(job.id, new Uint8Array([1]));
    clock.advance(1001);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("keeps a terminal job that is still within the TTL", () => {
    const clock = fixedClock(0);
    const store = new JobStore({ now: clock.now, terminalTtlMs: 1000 });
    const job = store.create(new AbortController());
    store.setSucceeded(job.id, new Uint8Array([1]));
    clock.advance(999);
    expect(store.get(job.id)?.status).toBe("succeeded");
  });

  it("rejects creating beyond maxLiveJobs with JobLimitError", () => {
    const store = new JobStore({ maxLiveJobs: 2 });
    store.create(new AbortController());
    store.create(new AbortController());
    expect(() => store.create(new AbortController())).toThrow(JobLimitError);
  });

  it("does not count terminal jobs against the live-job cap", () => {
    const store = new JobStore({ maxLiveJobs: 2 });
    const a = store.create(new AbortController());
    const b = store.create(new AbortController());
    // Both finish (one failed, one succeeded) → 0 live → new submits allowed,
    // even though the terminal records still exist (within TTL).
    store.setFailed(a.id, { code: "mineru_quota", message: "q" });
    store.setSucceeded(b.id, new Uint8Array([1]));
    expect(() => store.create(new AbortController())).not.toThrow();
    expect(() => store.create(new AbortController())).not.toThrow();
  });

  it("keeps a just-succeeded result even if it alone exceeds the byte cap", () => {
    const store = new JobStore({ maxTotalResultBytes: 4 });
    const job = store.create(new AbortController());
    store.setSucceeded(job.id, new Uint8Array(10)); // 10 > 4, but it's the newest
    expect(store.get(job.id)?.status).toBe("succeeded");
    expect((store.peekResult(job.id) ?? []).length).toBe(10);
  });

  it("evicts oldest terminal jobs when total result bytes exceed the cap", () => {
    const clock = fixedClock(0);
    const store = new JobStore({ now: clock.now, maxTotalResultBytes: 10 });
    const a = store.create(new AbortController());
    clock.advance(1);
    store.setSucceeded(a.id, new Uint8Array(6));
    const b = store.create(new AbortController());
    clock.advance(1);
    store.setSucceeded(b.id, new Uint8Array(6)); // 12 > 10 → evict oldest terminal (a)
    expect(store.get(a.id)).toBeUndefined();
    expect(store.get(b.id)?.status).toBe("succeeded");
  });
});
