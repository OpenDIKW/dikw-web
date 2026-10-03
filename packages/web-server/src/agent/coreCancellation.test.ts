// @vitest-environment node
import { expect, it } from "vitest";
import { CoreToolClient } from "./tools.js";

it.each(["read", "retrieve"] as const)("cancels a waiting Core %s operation", async (operation) => {
  const controller = new AbortController();
  const fetchImpl = ((_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(init?.signal?.reason);
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch;
  const client = new CoreToolClient({
    coreUrl: "http://core.invalid",
    signal: controller.signal,
    fetchImpl,
  });
  const pending = operation === "read" ? client.getJson("/v1/health") : client.retrieve("paper", 5);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
});
