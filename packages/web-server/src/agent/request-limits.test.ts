// @vitest-environment node
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi, afterEach } from "vitest";
import { createAgentHandler } from "./http";
import type { AdkSessionStore } from "./adkSessionStore";
import type { AgentRunner } from "./runtime";
afterEach(() => vi.useRealTimers());
function req(message: string, id = "session") {
  return Object.assign(Readable.from([JSON.stringify({ message })]), {
    url: `/sessions/${id}/messages`,
    method: "POST",
    headers: {},
  }) as IncomingMessage;
}
function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: "",
    destroyed: false,
    setHeader() {},
    write() {},
    end(body?: string) {
      this.body = body ?? "";
    },
  });
}
function setup(ownerReady?: Promise<void>) {
  let entered = 0;
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  const runner = {
    runMessage: vi.fn(async ({ signal }) => {
      entered++;
      signals.push(signal!);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        signal!.addEventListener("abort", () => resolve(), { once: true });
      });
    }),
  } as AgentRunner;
  const userStore = {
    ownerOf: async () => {
      await ownerReady;
      return "oidc:alice";
    },
    scopeOf: async () => undefined,
  };
  const store = { forUser: () => userStore } as unknown as AdkSessionStore;
  const handler = createAgentHandler({
    store,
    runner,
    subjectFor: () => "alice",
    serverCore: { coreUrl: "http://core.invalid" },
  });
  return {
    handler,
    runner,
    signals,
    releases,
    get entered() {
      return entered;
    },
  };
}
it("rejects excessive messages and JSON bodies before invoking a model", async () => {
  const f = setup();
  for (const size of [16001, 300000]) {
    const r = response();
    await f.handler(req("x".repeat(size)), r as unknown as ServerResponse);
    expect([400, 413]).toContain(r.statusCode);
  }
  expect(f.runner.runMessage).not.toHaveBeenCalled();
});
it("rejects a concurrent turn in the same session without cancelling the first", async () => {
  const f = setup();
  const a = response();
  const p = f.handler(req("one"), a as unknown as ServerResponse);
  await vi.waitFor(() => expect(f.entered).toBe(1));
  const b = response();
  await f.handler(req("two"), b as unknown as ServerResponse);
  expect(b.statusCode).toBe(429);
  expect(f.entered).toBe(1);
  expect(f.signals[0].aborted).toBe(false);
  f.releases.forEach((r) => r());
  await p;
});
it("cancels the model when the response connection closes and frees its slot", async () => {
  const f = setup();
  const a = response();
  const p = f.handler(req("one"), a as unknown as ServerResponse);
  await vi.waitFor(() => expect(f.entered).toBe(1));
  a.emit("close");
  expect(f.signals[0].aborted).toBe(true);
  await p;
  const b = response();
  const next = f.handler(req("retry"), b as unknown as ServerResponse);
  await vi.waitFor(() => expect(f.entered).toBe(2));
  f.releases.forEach((r) => r());
  await next;
});
it("limits each user to two concurrent sessions and releases completed slots", async () => {
  const f = setup();
  const a = f.handler(req("one", "a"), response() as unknown as ServerResponse);
  const b = f.handler(req("two", "b"), response() as unknown as ServerResponse);
  await vi.waitFor(() => expect(f.entered).toBe(2));
  const c = response();
  await f.handler(req("three", "c"), c as unknown as ServerResponse);
  expect(c.statusCode).toBe(429);
  expect(f.entered).toBe(2);
  f.releases.forEach((r) => r());
  await Promise.all([a, b]);
});
it("aborts turns at the hard deadline", async () => {
  vi.useFakeTimers();
  const f = setup();
  const res = response();
  const p = f.handler(req("one"), res as unknown as ServerResponse);
  await vi.waitFor(() => expect(f.entered).toBe(1));
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.signals[0].aborted).toBe(true);
  await p;
});
it("does not start paid work if the client disconnected during ownership lookup", async () => {
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  const f = setup(ready),
    res = response();
  const request = f.handler(req("one"), res as unknown as ServerResponse);
  res.destroyed = true;
  res.emit("close");
  release();
  await request;
  expect(f.runner.runMessage).not.toHaveBeenCalled();
});
it("closes a body which never finishes without starting a model", async () => {
  vi.useFakeTimers();
  const f = setup(),
    res = response();
  const incoming = Object.assign(new Readable({ read() {} }), {
    url: "/sessions/session/messages",
    method: "POST",
    headers: {},
  }) as IncomingMessage;
  const request = f.handler(incoming, res as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(15000);
  await request;
  expect(incoming.destroyed).toBe(true);
  expect(res.statusCode).toBe(408);
  expect(f.runner.runMessage).not.toHaveBeenCalled();
});
