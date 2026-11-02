// @vitest-environment node
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { MiniMaxLlm } from "./minimaxLlm";
it("does not multiply a budgeted model attempt with SDK retries", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "api_error", message: "fixture unavailable" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("no fixture listener");
  try {
    const llm = new MiniMaxLlm({
      model: "fixture",
      apiKey: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}`,
      maxCalls: 8,
      maxOutputTokens: 8192,
    });
    const drain = async () => {
      for await (const response of llm.generateContentAsync(
        {
          contents: [{ role: "user", parts: [{ text: "fixture" }] }],
          liveConnectConfig: {},
          toolsDict: {},
        },
        true,
      ))
        void response;
    };
    await expect(drain()).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
