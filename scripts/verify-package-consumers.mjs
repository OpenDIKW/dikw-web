import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifyUi } from "../tests/package-consumers/ui/verify.mjs";

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
    ...(manifest.packages.some((pkg) => pkg.name === "@opendikw/web-ui")
      ? [
          `react@${require("react/package.json").version}`,
          `react-dom@${require("react-dom/package.json").version}`,
          `vite@${require("vite/package.json").version}`,
          `@types/react@${require("@types/react/package.json").version}`,
          `@types/react-dom@${require("@types/react-dom/package.json").version}`,
        ]
      : []),
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
if (manifest.packages.some((pkg) => pkg.name === "@opendikw/web-ui")) {
  for (const name of ["main", "controls"]) {
    copyFileSync(`tests/package-consumers/ui/${name}.jsx`, `${cwd}/${name}.jsx`);
    writeFileSync(
      `${cwd}/${name === "main" ? "index" : name}.html`,
      `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Package consumer</title></head><body><div id="root"></div><script type="module" src="/${name}.jsx"></script></body></html>`,
    );
  }
  await verifyUi(cwd);
  copyFileSync("tests/package-consumers/ui/types.mts", `${cwd}/ui-types.mts`);
  const config = JSON.parse(readFileSync(`${cwd}/tsconfig.json`, "utf8"));
  config.compilerOptions.skipLibCheck = false;
  config.include.push("ui-types.mts");
  writeFileSync(`${cwd}/tsconfig.json`, JSON.stringify(config));
  execFileSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", `${cwd}/tsconfig.json`],
    { cwd, stdio: "inherit" },
  );
  // Ambient declarations from reader/CSS must not accidentally make another
  // subentry compile. Each entry gets a separate strict TypeScript program.
  for (const entry of [
    "controls",
    "reader",
    "hooks",
    "auth",
    "theme",
    "tokens.css",
    "controls.css",
    "reader.css",
  ]) {
    writeFileSync(`${cwd}/entry.mts`, `import "@opendikw/web-ui/${entry}";\n`);
    writeFileSync(
      `${cwd}/entry-tsconfig.json`,
      JSON.stringify({ ...config, include: ["entry.mts"] }),
    );
    execFileSync(
      process.execPath,
      [require.resolve("typescript/bin/tsc"), "-p", `${cwd}/entry-tsconfig.json`],
      { cwd, stdio: "inherit" },
    );
  }
  console.log("Packed UI controls, shared AuthContext, reader hydration, fonts and theme passed.");
}
