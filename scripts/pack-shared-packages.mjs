import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { resolve, posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const SHARED_NAMES = ["@opendikw/web-client", "@opendikw/web-ui", "@opendikw/web-server"];
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/;

export function assertPublishablePackage(pkg) {
  if (pkg.private) throw new Error("Cannot publish a private application");
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (!EXACT_VERSION.test(version))
      throw new Error(`Dependency ${name} requires an exact version: ${version}`);
    if (name.startsWith("@opendikw/") && version !== pkg.version)
      throw new Error(`Shared dependency versions must match: ${name}`);
  }
  if (!SHARED_NAMES.includes(pkg.name)) throw new Error(`Unexpected shared package: ${pkg.name}`);
  if (!EXACT_VERSION.test(pkg.version)) throw new Error(`Invalid package version: ${pkg.version}`);
  if (pkg.license !== "MIT") throw new Error(`Missing MIT license: ${pkg.name}`);
  if (
    !Array.isArray(pkg.files) ||
    pkg.files.length !== 3 ||
    !["dist", "README.md", "LICENSE"].every((file) => pkg.files.includes(file))
  )
    throw new Error(`Package files must allow only dist, README.md and LICENSE: ${pkg.name}`);
}

export function assertCohort(packages) {
  if (new Set(packages.map((pkg) => pkg.version)).size !== 1)
    throw new Error("Shared package versions must match");
  if (
    packages.length !== 3 ||
    new Set(packages.map((pkg) => pkg.name)).size !== 3 ||
    SHARED_NAMES.some((name) => !packages.some((pkg) => pkg.name === name))
  )
    throw new Error("Release requires all three shared packages exactly once");
  for (const pkg of packages) assertPublishablePackage(pkg);
}

export function assertPackedPackage(pkg, files, cwd) {
  assertPublishablePackage(pkg);
  const included = new Set(files.map((file) => file.path));
  const required = (path) => {
    if (!included.has(path)) throw new Error(`Packed package missing ${pkg.name}/${path}`);
  };
  for (const path of ["package.json", "README.md", "LICENSE"]) required(path);
  for (const [entry, targets] of Object.entries(pkg.exports ?? {})) {
    if (!entry.startsWith("./") || !targets.types || !targets.types.endsWith(".d.ts"))
      throw new Error(`Public entry missing declarations: ${pkg.name}/${entry}`);
    for (const target of Object.values(targets)) {
      if (typeof target !== "string" || !target.startsWith("./dist/") || target.includes(".."))
        throw new Error(`Export escapes dist: ${pkg.name}/${entry}`);
      required(target.slice(2));
    }
  }
  if (!Object.keys(pkg.exports ?? {}).length)
    throw new Error(`Package has no public entries: ${pkg.name}`);
  const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies };
  const reference = (source, specifier) => {
    if (/^(?:https?:|data:|#)/.test(specifier) || isBuiltin(specifier)) return;
    if (specifier.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(source), specifier));
      if (!target.startsWith("dist/"))
        throw new Error(`Import escapes dist: ${source} -> ${specifier}`);
      required(target);
    } else {
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!(name in dependencies))
        throw new Error(`Import uses undeclared dependency: ${source} -> ${name}`);
    }
  };
  for (const path of included) {
    if (
      !/^(?:dist\/|package\.json$|README\.md$|LICENSE$)/.test(path) ||
      /(?:^|\/)(?:\.env(?:\.|$)|mb\/)|\.sqlite(?:$|[.-])|\.test\.|fakeIdp\.|(?:MbApp|PaperLibrary|NotesView|ResearchWorkspace|QaPanel|wisdom-sync)\./.test(
        path,
      )
    )
      throw new Error(`Unexpected public package file: ${pkg.name}/${path}`);
    if (!/\.(?:js|mjs|ts|css)$/.test(path)) continue;
    const body = readFileSync(resolve(cwd, path), "utf8");
    if (path.endsWith(".css")) {
      for (const match of body.matchAll(/@import\s+["']([^"']+)["']/g)) reference(path, match[1]);
      for (const match of body.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
        const value = match[1];
        reference(
          path,
          /^(?:https?:|data:|#)/.test(value) ? value : value.startsWith(".") ? value : `./${value}`,
        );
      }
    } else {
      const ast = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, false);
      const visit = (node) => {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
              ? node.argument.literal
              : ts.isExternalModuleReference(node)
                ? node.expression
                : ts.isCallExpression(node) &&
                    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                      (ts.isIdentifier(node.expression) && node.expression.text === "require"))
                  ? node.arguments[0]
                  : undefined;
        if (specifier && ts.isStringLiteralLike(specifier)) reference(path, specifier.text);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  }
}

export function packSharedPackages() {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run this script through npm run pack:shared");
  const destination = resolve(".tmp/shared-packages");
  mkdirSync(destination, { recursive: true });
  const manifests = SHARED_NAMES.map((name) => {
    const cwd = resolve(`packages/${name.split("/")[1]}`);
    return { cwd, pkg: JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")) };
  });
  assertCohort(manifests.map(({ pkg }) => pkg));
  execFileSync(process.execPath, ["scripts/build-shared-packages.mjs"], { stdio: "inherit" });
  const packages = manifests.map(({ cwd, pkg }) => {
    const [packed] = JSON.parse(
      execFileSync(
        process.execPath,
        [npm, "pack", "--json", "--ignore-scripts", "--pack-destination", destination],
        { cwd, encoding: "utf8" },
      ),
    );
    assertPackedPackage(pkg, packed.files, cwd);
    return {
      name: packed.name,
      version: packed.version,
      tarball: packed.filename,
      integrity: packed.integrity,
    };
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const manifest = { commit, version: packages[0].version, packages };
  writeFileSync(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Packed ${packages.length} shared packages at ${manifest.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  packSharedPackages();
