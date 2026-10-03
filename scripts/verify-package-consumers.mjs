import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this script through npm run verify:packages");
const manifest = JSON.parse(readFileSync(".tmp/shared-packages/manifest.json", "utf8"));
mkdirSync(".tmp", { recursive: true });
const cwd = mkdtempSync(resolve(tmpdir(), "dikw-package-consumer-"));
writeFileSync(`${cwd}/package.json`, JSON.stringify({ private: true, type: "module" }));
execFileSync(
  process.execPath,
  [
    npm,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...manifest.packages.map((pkg) => resolve(`.tmp/shared-packages/${pkg.tarball}`)),
  ],
  {
    cwd,
    stdio: "inherit",
  },
);
copyFileSync("tests/package-consumers/client/runtime.mjs", `${cwd}/client.mjs`);
copyFileSync("tests/package-consumers/client/types.mts", `${cwd}/types.mts`);
writeFileSync(
  `${cwd}/tsconfig.json`,
  JSON.stringify({
    compilerOptions: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      types: [],
    },
    include: ["types.mts"],
  }),
);
execFileSync(process.execPath, [`${cwd}/client.mjs`], { cwd, stdio: "inherit" });
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", `${cwd}/tsconfig.json`],
  { cwd, stdio: "inherit" },
);
console.log("Packed client runtime and NodeNext declarations passed in an independent install.");
