import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
for (const dependency of ["vite", "react", "@opendikw/web-ui"])
  assert.throws(() => require.resolve(dependency), { code: "MODULE_NOT_FOUND" });
const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
const { createWebRuntime, isRequestAllowed } = await import("@opendikw/web-server/runtime");
const { registerOutboundInstrumentation } = await import("@opendikw/web-server/instrumentation");
assert.equal(typeof registerOutboundInstrumentation, "function");
assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signals);
assert.equal(isRequestAllowed("mbweb", "POST", "/v1/lint/apply"), false);
const cwd = join(process.cwd(), "runtime-fixture");
await mkdir(join(cwd, "dist"), { recursive: true });
await writeFile(join(cwd, "dist/index.html"), "<!doctype html><title>Packed runtime</title>");
const options = {
  appId: "dikw-web",
  profile: "workbench",
  cwd,
  env: {
    DIKW_AGENT_API_KEY: "fixture-only",
    DIKW_AGENT_BASE_URL: "http://127.0.0.1:9",
    DIKW_AGENT_MODEL: "fixture",
    DIKW_WEB_AUTH_MODE: "off",
  },
};
let runtime = await createWebRuntime(options);
const server = createServer((req, res) => {
  void runtime.handler(req, res);
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.match(await (await fetch(base)).text(), /Packed runtime/);
  const response = await fetch(`${base}/agent/sessions`, { method: "POST" });
  assert.equal(response.status, 201);
  const session = await response.json();
  await runtime.close();
  await runtime.close();
  runtime = await createWebRuntime(options);
  assert.ok(
    (await (await fetch(`${base}/agent/sessions`)).json()).some((item) => item.id === session.id),
  );
} finally {
  await runtime.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(cwd, { recursive: true, force: true });
}
console.log("Packed Node runtime, import isolation, SQLite restart and resource cleanup passed.");
