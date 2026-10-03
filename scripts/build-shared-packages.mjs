import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
// Explicit builds also work with ignore-scripts=true and a clean npm ci.
for (const name of ["web-client", "web-ui", "web-server"]) {
  const project = `packages/${name}/tsconfig.build.json`;
  if (!existsSync(project)) continue;
  execFileSync(process.execPath, [tsc, "-p", project], { stdio: "inherit" });
}
