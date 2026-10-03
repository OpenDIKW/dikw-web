import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertReleaseInputs } from "./publish-shared-packages.mjs";

function registryUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "registry.npmjs.org" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error("Package downloads must use the public npm registry");
  return url;
}

export function assertRegistryArtifact(pkg, metadata, bytes) {
  if (metadata.name !== pkg.name || metadata.version !== pkg.version)
    throw new Error(`Registry package name/version mismatch: ${pkg.name}`);
  registryUrl(metadata.dist?.tarball);
  const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
  if (metadata.dist?.integrity !== pkg.integrity || integrity !== pkg.integrity)
    throw new Error(`Registry integrity mismatch: ${pkg.name}@${pkg.version}`);
}

async function download(url) {
  const response = await fetch(registryUrl(url), {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Registry download failed: HTTP ${response.status}`);
  return response;
}

export async function verifyRegistryPackages() {
  if (!process.env.npm_execpath) throw new Error("Run this script through npm run verify:registry");
  const source = resolve(".tmp/shared-packages");
  const manifest = JSON.parse(readFileSync(`${source}/manifest.json`, "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assertReleaseInputs(
    manifest,
    {
      commit,
      dirty,
      tag: manifest.version?.includes("-") ? "next" : "latest",
    },
    (name) => readFileSync(`${source}/${name}`),
  );
  const destination = resolve(".tmp/registry-shared-packages");
  mkdirSync(destination, { recursive: true });
  for (const pkg of manifest.packages) {
    const metadata = await (
      await download(
        `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`,
      )
    ).json();
    const bytes = Buffer.from(await (await download(metadata.dist?.tarball)).arrayBuffer());
    assertRegistryArtifact(pkg, metadata, bytes);
    writeFileSync(`${destination}/${pkg.tarball}`, bytes);
  }
  writeFileSync(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  execFileSync(process.execPath, ["scripts/verify-package-consumers.mjs"], {
    stdio: "inherit",
    env: { ...process.env, SHARED_PACKAGE_DIRECTORY: destination },
  });
  writeFileSync(
    `${destination}/verification.json`,
    JSON.stringify(
      {
        commit,
        version: manifest.version,
        registry: "https://registry.npmjs.org",
        verifiedAt: new Date().toISOString(),
        packages: manifest.packages,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Registry bytes and independent consumers passed for ${manifest.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await verifyRegistryPackages();
