import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXACT_VERSION, SHARED_NAMES, assertCohort } from "./pack-shared-packages.mjs";

export function assertReleaseInputs(manifest, { commit, dirty, tag }, readArtifact) {
  if (dirty) throw new Error("Release requires a clean source checkout");
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.commit !== commit)
    throw new Error("Verified artifact commit does not match HEAD");
  if (!["next", "latest"].includes(tag)) throw new Error("Release tag must be next or latest");
  if (!EXACT_VERSION.test(manifest.version)) throw new Error("Invalid release version");
  const prerelease = manifest.version.includes("-");
  if ((tag === "latest" && prerelease) || (tag === "next" && !prerelease))
    throw new Error("Use next for prereleases and latest for stable versions");
  const packages = manifest.packages ?? [];
  if (
    packages.length !== 3 ||
    new Set(packages.map((pkg) => pkg.name)).size !== 3 ||
    SHARED_NAMES.some((name) => !packages.some((pkg) => pkg.name === name))
  )
    throw new Error("Release requires all three shared packages exactly once");
  for (const pkg of packages) {
    if (pkg.version !== manifest.version)
      throw new Error(`Mismatched package version: ${pkg.name}`);
    const expected = `${pkg.name.slice(1).replace("/", "-")}-${pkg.version}.tgz`;
    if (pkg.tarball !== expected) throw new Error(`Unexpected tarball path: ${pkg.name}`);
    const integrity =
      "sha512-" + createHash("sha512").update(readArtifact(pkg.tarball)).digest("base64");
    if (integrity !== pkg.integrity) throw new Error(`Tarball integrity mismatch: ${pkg.name}`);
  }
}

export function planPublications(manifest, tag, published) {
  return manifest.packages.map((pkg) => {
    const existing = published.get(pkg.name);
    if (!existing) return { ...pkg, action: "publish" };
    if (existing.integrity !== pkg.integrity)
      throw new Error(`Registry version has different content: ${pkg.name}@${pkg.version}`);
    if (existing.tagVersion !== pkg.version)
      throw new Error(
        `Existing ${pkg.name}@${pkg.version} does not have the ${tag} tag; resolve this explicitly`,
      );
    return { ...pkg, action: "skip" };
  });
}

async function publishedPackage(pkg, tag) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { "cache-control": "no-cache" },
  });
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Registry lookup failed for ${pkg.name}: HTTP ${response.status}`);
  const metadata = await response.json();
  const version = metadata.versions?.[pkg.version];
  if (!version) return undefined;
  return { integrity: version.dist?.integrity, tagVersion: metadata["dist-tags"]?.[tag] };
}

export async function publishSharedPackages(args = process.argv.slice(2)) {
  let tag = "next";
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--tag") tag = args[++index];
    else if (args[index] === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run this script through npm run publish:shared");
  const npmVersion = execFileSync(process.execPath, [npm, "--version"], { encoding: "utf8" })
    .trim()
    .split(".")
    .map(Number);
  if (
    Number(process.versions.node.split(".")[0]) < 24 ||
    npmVersion[0] < 11 ||
    (npmVersion[0] === 11 && (npmVersion[1] < 5 || (npmVersion[1] === 5 && npmVersion[2] < 1)))
  )
    throw new Error("Release requires Node >=24 and npm >=11.5.1");
  const directory = resolve(".tmp/shared-packages");
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  assertReleaseInputs(manifest, { commit, dirty, tag }, (name) =>
    readFileSync(`${directory}/${name}`),
  );
  const source = SHARED_NAMES.map((name) =>
    JSON.parse(readFileSync(`packages/${name.split("/")[1]}/package.json`, "utf8")),
  );
  assertCohort(source);
  if (source[0].version !== manifest.version)
    throw new Error("Source and tarball versions do not match");
  // Inspect every registry version before making the first write. An existing
  // immutable version with different bytes stops the entire release.
  const published = new Map();
  for (const pkg of manifest.packages) published.set(pkg.name, await publishedPackage(pkg, tag));
  const actions = planPublications(manifest, tag, published);
  const receipt = { commit, version: manifest.version, tag, dryRun, packages: [] };
  for (const pkg of actions) {
    if (pkg.action === "publish") {
      execFileSync(
        process.execPath,
        [
          npm,
          "publish",
          `${directory}/${pkg.tarball}`,
          "--access",
          "public",
          "--tag",
          tag,
          "--ignore-scripts",
          "--registry",
          "https://registry.npmjs.org",
          ...(dryRun ? ["--dry-run"] : []),
        ],
        { stdio: "inherit" },
      );
    }
    receipt.packages.push({
      name: pkg.name,
      version: pkg.version,
      integrity: pkg.integrity,
      status: pkg.action === "skip" ? "already_published" : dryRun ? "dry_run" : "published",
    });
    writeFileSync(`${directory}/publication.json`, JSON.stringify(receipt, null, 2) + "\n");
    console.log(`${pkg.action}: ${pkg.name}@${pkg.version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await publishSharedPackages();
