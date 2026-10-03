import { execFileSync } from "node:child_process";
import { existsSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
// Explicit builds also work with ignore-scripts=true and a clean npm ci.
for (const name of ["web-client", "web-ui", "web-server"]) {
  const project = `packages/${name}/tsconfig.build.json`;
  if (!existsSync(project)) continue;
  execFileSync(process.execPath, [tsc, "-p", project], { stdio: "inherit" });
  const styles = `packages/${name}/styles`;
  if (existsSync(styles)) cpSync(styles, `packages/${name}/dist/styles`, { recursive: true });
  if (name === "web-ui") {
    cpSync("packages/web-ui/src/styles.d.ts", "packages/web-ui/dist/styles.d.ts");
    for (const entry of ["reader", "hooks"]) {
      const types = `packages/web-ui/dist/${entry}/index.d.ts`;
      writeFileSync(
        types,
        '/// <reference path="../styles.d.ts" />\n' + readFileSync(types, "utf8"),
      );
    }
  }
}
