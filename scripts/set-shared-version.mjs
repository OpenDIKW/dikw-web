import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXACT_VERSION, SHARED_NAMES } from "./pack-shared-packages.mjs";

export function updateSharedVersions(manifests, version) {
  if (!EXACT_VERSION.test(version)) throw new Error("Expected an exact SemVer release version");
  if (SHARED_NAMES.some((name) => manifests.filter((pkg) => pkg.name === name).length !== 1))
    throw new Error("Version update requires all three shared packages exactly once");
  return manifests.map((manifest) => {
    const pkg = structuredClone(manifest);
    if (SHARED_NAMES.includes(pkg.name)) pkg.version = version;
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[group] ?? {})) {
        if (SHARED_NAMES.includes(name)) pkg[group][name] = version;
      }
    }
    return pkg;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = [
    "package.json",
    ...SHARED_NAMES.map((name) => `packages/${name.split("/")[1]}/package.json`),
  ];
  const manifests = paths.map((path) => JSON.parse(readFileSync(path, "utf8")));
  const updated = updateSharedVersions(manifests, process.argv[2]);
  paths.forEach((path, index) =>
    writeFileSync(path, JSON.stringify(updated[index], null, 2) + "\n"),
  );
  console.log(
    `Set shared cohort to ${process.argv[2]}; run npm install --package-lock-only --ignore-scripts, then verify and commit.`,
  );
}
