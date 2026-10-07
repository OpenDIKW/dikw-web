// @vitest-environment node
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Re-executing the entry calls createRoot() on #root a second time, and the two
// roots then fight over the DOM (`removeChild` page errors). @vitejs/plugin-react
// makes every module that defines a component accept its own HMR updates, so the
// entry must define none: an edit then hot-swaps a component module or reloads.
let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false },
  });
}, 30_000);

afterAll(async () => {
  await server.close();
});

async function acceptsOwnUpdates(id: string): Promise<boolean> {
  const result = await server.transformRequest(id);
  return /import\.meta\.hot\.accept\(/.test(result?.code ?? "");
}

describe("entry HMR", () => {
  it("never re-executes the module that owns the React root", async () => {
    expect(await acceptsOwnUpdates("/src/main.tsx")).toBe(false);
    // Control: the components it renders stay Fast Refresh boundaries.
    expect(await acceptsOwnUpdates("/src/Root.tsx")).toBe(true);
  }, 30_000);
});
