import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this script through npm run pack:shared");
const destination = resolve(".tmp/shared-packages");
mkdirSync(destination, { recursive: true });
execFileSync(process.execPath, ["scripts/build-shared-packages.mjs"], { stdio: "inherit" });
const packages = [];
for (const name of ["web-client", "web-ui", "web-server"]) {
  const cwd = resolve(`packages/${name}`);
  if (!existsSync(`${cwd}/package.json`)) continue;
  const [packed] = JSON.parse(
    execFileSync(
      process.execPath,
      [npm, "pack", "--json", "--ignore-scripts", "--pack-destination", destination],
      {
        cwd,
        encoding: "utf8",
      },
    ),
  );
  for (const file of packed.files) {
    if (
      !/^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(file.path) ||
      /\.test\.|fakeIdp\./.test(file.path)
    ) {
      throw new Error(`Unexpected public package file: ${packed.name}/${file.path}`);
    }
  }
  const manifest = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
  if (manifest.license !== "MIT") throw new Error(`Missing MIT license: ${manifest.name}`);
  packages.push({
    name: packed.name,
    version: packed.version,
    tarball: packed.filename,
    integrity: packed.integrity,
  });
}
const versions = new Set(packages.map((pkg) => pkg.version));
if (versions.size !== 1) throw new Error("Shared package versions must match");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync(
  `${destination}/manifest.json`,
  JSON.stringify({ commit, version: packages[0].version, packages }, null, 2) + "\n",
);
console.log(`Packed ${packages.length} shared package(s) at ${packages[0].version}`);
